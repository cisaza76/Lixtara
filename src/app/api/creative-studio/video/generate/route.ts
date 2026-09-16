// POST /api/creative-studio/video/generate — Gate C1 (docs/superpowers/plans/
// 2026-07-15-creative-studio-p2-video.md, Task 6/"Enqueue route"). Body: { property_id }.
//
// Flow: flag gate (fail-closed, FIRST) -> auth -> rate-limit -> body -> ownership ->
// readiness (video capability) -> server-built idempotency key -> createJob (queued) ->
// 202 { jobId }. This route NEVER opens a Sandbox and NEVER renders — a decoupled worker
// (Task 6's cron route, not built here) claims and processes the job. CODE ONLY as of
// this commit: the `creative_jobs`/`assets` migration is authored but NOT applied, no
// bucket exists, and CREATIVE_STUDIO_VIDEO_ENABLED is unset in every environment.
//
// Client-supplied identity/state fields are structurally impossible to honor here: the
// request body type below has ONLY `property_id`, so `ownerId`/`provider`/`state`/
// `storagePath`/`idempotencyKey`/`assetId` are never read even if present in the JSON —
// the server derives every one of those from auth, ownership, and the readiness/
// idempotency computation below.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createService } from "@/lib/supabase/service";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";
import { classifyAssets } from "@/lib/media-intelligence/classify";
import type { Asset as MediaAsset, Classification } from "@/lib/media-intelligence/types";
import { evaluateCapabilityReadiness } from "@/lib/media-intelligence/readiness";
import { classifyVisionFailure } from "@/lib/media-intelligence/classify-errors";
import { defaultResolveVideoSource } from "@/lib/video-engine/resolve-video-source";
import { isUsableSourceVideo } from "@/lib/video-engine/job-routing";
import type { SourceStrategy } from "@/lib/video-engine/source-strategy";
import { referenceCodeFromTraceId } from "@/lib/creative-studio/seller-failure-kind";
import { logVideoEvent } from "@/lib/video-engine/observability-log";
import { SupabaseAssetStore } from "@/lib/assets/asset-store.supabase";
import type { Asset } from "@/lib/assets/types";
import { createJob, type JobsStore } from "@/lib/creative-jobs/jobs";
import { SupabaseJobsStore } from "@/lib/creative-jobs/jobs-store.supabase";
import { buildIdempotencyKey, hashSourceAssetIds } from "@/lib/video-engine/idempotency";
import { TEMPLATE_VERSION } from "@/lib/video-engine/versions";
import type { QuotaConsumeResult } from "@/lib/creative-studio/video-access";
import {
  checkVideoAccess,
  videoAccessDenial,
  videoAccessStore,
  activityLogPort,
  type CheckVideoAccess,
} from "@/lib/creative-studio/video-access-guard";
import {
  auditAccessBlocked,
  auditGenerationRequested,
  auditQuotaConsumed,
  type ActivityLogPort,
} from "@/lib/creative-studio/video-access-audit";

export function isCreativeStudioVideoEnabled(): boolean {
  return process.env.CREATIVE_STUDIO_VIDEO_ENABLED === "true";
}

interface Body {
  property_id?: string;
}

interface PropertyRow {
  id: string;
  owner_id: string;
  mls_status: string | null;
}

interface PhotoRow {
  id: string;
  url: string | null;
}

// Injected dependencies — mirrors the AgentDeps pattern (@/lib/media-intelligence/agent)
// so this route is unit-testable end to end with fakes: no real Supabase/Upstash/LLM
// call in tests. `handleGenerateVideo` below is the exported, directly-callable handler;
// `POST` only adds the flag gate + wires the real deps.
export interface GenerateVideoDeps {
  getUser(): Promise<{ id: string } | null>;
  // Ownership-scoped read — returns the row regardless of RLS's separate "active
  // listings are publicly readable" policy; `handleGenerateVideo` does the actual
  // owner_id === user.id comparison, so a non-owner never gets past 403 even for an
  // active listing.
  loadProperty(propertyId: string): Promise<PropertyRow | null>;
  loadPhotos(propertyId: string): Promise<PhotoRow[]>;
  classify(assets: MediaAsset[]): Promise<Classification[]>;
  // Autoridad única del Source Video vigente (excluye archivados — Issue #118). Decide la
  // estrategia AQUÍ con la misma función que el worker, para que no puedan divergir.
  resolveSource(listingId: string, ownerId: string): Promise<Asset | null>;
  jobsStore: JobsStore;
  now(): number;
  checkRateLimit(userId: string): Promise<Response | null>;
  // Gate 5 access authority: allowlist + per-listing scope + quota (fail-closed). Runs AFTER
  // ownership, BEFORE any render work is enqueued.
  checkAccess: CheckVideoAccess;
  // Atomically consume one generation slot — called ONLY when createJob actually inserted the
  // job (created===true), so retries of the same logical job never double-consume.
  consumeQuota(input: { grantId: string; userId: string; expectedUsed: number }): Promise<QuotaConsumeResult>;
  // Best-effort audit trail (activity_log). Never gates the request.
  audit: ActivityLogPort;
}

function defaultDeps(): GenerateVideoDeps {
  // Lazily memoized so a single POST only ever creates one RLS-scoped client, even
  // though getUser/loadProperty/loadPhotos each ask for it.
  let clientPromise: ReturnType<typeof createClient> | null = null;
  function client() {
    if (!clientPromise) clientPromise = createClient();
    return clientPromise;
  }

  return {
    async getUser() {
      const supabase = await client();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user ? { id: user.id } : null;
    },
    async loadProperty(propertyId) {
      const supabase = await client();
      const { data } = await supabase
        .from("properties")
        .select("id, owner_id, mls_status")
        .eq("id", propertyId)
        .maybeSingle();
      return (data as PropertyRow | null) ?? null;
    },
    async loadPhotos(propertyId) {
      const supabase = await client();
      const { data } = await supabase
        .from("property_photos")
        .select("id, url")
        .eq("property_id", propertyId)
        .order("display_order", { ascending: true });
      return (data as PhotoRow[] | null) ?? [];
    },
    classify: (assets) => classifyAssets(assets),
    resolveSource: defaultResolveVideoSource(new SupabaseAssetStore(createService())),
    // Constructed once, lazily, only when a real POST reaches here (after the flag
    // gate) — never at module load, never in a test that supplies its own jobsStore.
    jobsStore: new SupabaseJobsStore(createService()),
    now: () => Date.now(),
    async checkRateLimit(userId) {
      return enforceLimit(
        apiLimiter("creative-studio:video:generate", 5, "1 h"),
        `u:${userId}`,
        { label: "creative-studio:video:generate", message: "Too many requests. Please wait." },
      );
    },
    checkAccess: checkVideoAccess,
    consumeQuota: (input) => videoAccessStore().consumeGeneration(input),
    audit: activityLogPort(),
  };
}

// The testable handler. Tests call this directly with fake deps — no real Supabase,
// Upstash, or LLM call — and never go through `POST`'s flag gate (that's covered
// separately, mirroring the media-agent route's `isMediaAgentEnabled`/`POST` split).
export async function handleGenerateVideo(req: Request, deps: GenerateVideoDeps): Promise<Response> {
  const user = await deps.getUser();
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const limited = await deps.checkRateLimit(user.id);
  if (limited) return limited;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const propertyId = body.property_id;
  if (!propertyId) {
    return NextResponse.json({ error: "property_id_required" }, { status: 400 });
  }

  // Ownership: RLS may return an active listing regardless of who's asking (see
  // `properties_public_read_active`), so this is an explicit owner_id check, not just
  // "row came back."
  const property = await deps.loadProperty(propertyId);
  if (!property || property.owner_id !== user.id) {
    return NextResponse.json({ error: "property_not_found_or_not_yours" }, { status: 403 });
  }

  // Gate 5 access authority (validation order: flag → auth → ownership → ACCESS → route logic).
  // Fail-closed: a non-allowlisted seller, an out-of-scope listing, an exhausted quota, or a
  // reader error all stop here — before any source resolution or job enqueue. The feature stays
  // invisible (404) to everyone but allowlisted sellers; only an out-of-quota allowlisted seller
  // sees a 403 quota_exhausted. videoAccessDenial is the GENERATE-surface mapping (quota gates
  // generation); the read/upload surfaces use videoVisibilityDenial (quota does not hide them).
  const access = await deps.checkAccess({ userId: user.id, listingId: propertyId });
  const denial = videoAccessDenial(access);
  if (denial) {
    await auditAccessBlocked(deps.audit, {
      userId: user.id,
      listingId: propertyId,
      metadata: { reason: access.reason }, // enum-like only; no PII
    });
    return NextResponse.json(denial.body, { status: denial.status });
  }

  // -------------------------------------------------------------------------------------
  // READINESS POR ESTRATEGIA (2026-08-11).
  //
  // Antes, TODA generación pasaba por el clasificador de fotos, aun cuando el vendedor había
  // subido un video. Una foto de 8160×6120 hizo que el proveedor de visión devolviera 400 y
  // que /generate reventara antes de crear el job: sin trace_id, sin evidence pack, y con la
  // UI prometiendo que reintentar funcionaría. Las fotos NO participan en uploaded_video.
  //
  // La estrategia se decide con `isUsableSourceVideo`, la MISMA función que usa el worker
  // (job-routing.ts), así que enqueue y ejecución no pueden divergir.
  //
  // Puertas que siguen aplicando a AMBAS estrategias (ninguna se relaja aquí):
  //   flag · sesión · ownership del listing · allowlist/grant · cuota · rate limit ·
  //   listing aprobado (mls_status = "active")
  // Exclusivo de photo_slideshow: fotos presentes + al menos un interior clasificado.
  // Exclusivo de uploaded_video: un Source Video vigente y utilizable (ya resuelto aquí);
  //   su validez TÉCNICA (contenedor, códec, duración, HDR…) la comprueba el pipeline en la
  //   etapa `validating`, donde sí existe job, trace y evidence pack.
  // -------------------------------------------------------------------------------------
  const sourceVideo = await deps.resolveSource(propertyId, user.id);
  const strategy: SourceStrategy = isUsableSourceVideo(sourceVideo) ? "uploaded_video" : "photo_slideshow";
  const listingApproved = property.mls_status === "active";

  // Referencia de soporte acuñada ANTES de evaluar readiness: un fallo pre-job no tiene
  // creative_job donde colgar un trace_id, así que este es su único identificador estable.
  const preflightRef = crypto.randomUUID();
  const reference = referenceCodeFromTraceId(preflightRef);

  const preflightFailure = (
    status: number,
    body: Record<string, unknown>,
    log: { category: string; reason: string; retryable: boolean; provider?: string },
  ): Response => {
    logVideoEvent("video_preflight_failed", {
      stage: "readiness",
      strategy,
      listingId: propertyId,
      userId: user.id,
      preflightRef,
      reference,
      ...log,
    });
    return NextResponse.json({ ...body, retryable: log.retryable, reference }, { status });
  };

  let sourceAssetIds: string[];

  if (strategy === "uploaded_video") {
    // Ni loadPhotos ni classify: el desacoplamiento es estructural, no una comprobación.
    if (!listingApproved) {
      return preflightFailure(
        422,
        { error: "not_ready", reasons: [{ code: "listing_not_approved" }], suggestedActions: [{ code: "await_listing_approval" }] },
        { category: "INPUT", reason: "listing_not_approved", retryable: false },
      );
    }
    sourceAssetIds = [sourceVideo!.id];
  } else {
    const photoRows = await deps.loadPhotos(propertyId);
    const mediaAssets: MediaAsset[] = photoRows
      .filter((r): r is { id: string; url: string } => Boolean(r.url))
      .map((r) => ({ photoId: r.id, url: r.url }));

    // El clasificador es una llamada a un proveedor externo: puede fallar de formas que NO
    // son culpa del vendedor. Ninguna puede escapar como 500 sin clasificar.
    let classifications: Classification[];
    try {
      classifications = await deps.classify(mediaAssets);
    } catch (err) {
      const failure = classifyVisionFailure(err);
      return preflightFailure(
        failure.retryable ? 503 : 422,
        {
          error: failure.retryable ? "provider_unavailable" : "not_ready",
          reasons: [{ code: `photo_analysis_${failure.kind}` }],
          suggestedActions: [{ code: failure.retryable ? "retry_later" : "review_photos" }],
        },
        { category: "INPUT", reason: `photo_analysis_${failure.kind}`, retryable: failure.retryable, provider: "vision" },
      );
    }

    const readiness = evaluateCapabilityReadiness("video", {
      photoCount: mediaAssets.length,
      scores: [], // video's readiness branch never reads ctx.scores — see readiness.ts
      classifications,
      listingApproved,
    });

    if (readiness.status !== "ready") {
      return preflightFailure(
        422,
        { error: "not_ready", reasons: readiness.reasons, suggestedActions: readiness.suggestedActions },
        { category: "INPUT", reason: readiness.reasons.map((r) => r.code).join(",") || "not_ready", retryable: false },
      );
    }
    sourceAssetIds = mediaAssets.map((a) => a.photoId);
  }

  // Server-built idempotency key — NEVER the client-supplied `idempotencyKey` (there is
  // none to read; `Body` has no such field). Derived entirely from the ownership-checked
  // listingId, the pinned template version, and the resolved source-asset id set: las fotos
  // para photo_slideshow, el Source Video para uploaded_video. Así, reemplazar el source
  // produce una clave distinta (y por tanto un job nuevo), mientras que volver a pulsar el
  // botón con el mismo source colapsa sobre el job existente.
  const idempotencyKey = buildIdempotencyKey({
    listingId: propertyId,
    capability: "video",
    templateVersion: TEMPLATE_VERSION,
    sourceAssetIds,
    inputHash: hashSourceAssetIds(sourceAssetIds),
  });

  // createJob is itself idempotent (src/lib/creative-jobs/jobs.ts): an existing ACTIVE
  // job with this key is returned instead of a duplicate insert (race-safe via the
  // store's 23505 catch). ownerId/state are always server values — `user.id` and
  // `"queued"` — never anything from the request body.
  //
  // A stable traceId is stamped HERE, at creation, NOT left null for the worker to fill
  // in later: it's the durable correlation key threaded job -> pipeline -> produceVideoAsset
  // -> Asset.provenance.traceId (see worker-deps.ts's buildRealProduce/buildRealReconcile).
  // Without it, a worker that crashes AFTER a real upload + Asset insert but BEFORE the
  // final `completed` transition persists has no way for `buildRealReconcile` to find the
  // already-persisted Asset on recovery (job.assetId is only set at that final transition)
  // — recovery would re-render and duplicate the Asset + Storage object.
  const { job, created } = await createJob(deps.jobsStore, {
    listingId: propertyId,
    ownerId: user.id,
    capability: "video",
    idempotencyKey,
    nowMs: deps.now(),
    traceId: crypto.randomUUID(),
  });

  // Consume ONE generation slot — but ONLY when THIS call actually created the job (created===true).
  // A retry / concurrent duplicate of the same logical job returns created===false and must NOT
  // consume again (that is the whole reason createJob returns `created`). Quota is a safety rail,
  // not a billing meter, and enforced EVENTUALLY, not as a hard atomic cap: if the CAS misses here
  // (a distinct-key concurrent burst raced the same slot) we do NOT fail the already-created job —
  // we record consumed:false and proceed (safe direction). A concurrent burst can therefore
  // over-render by up to (burst − 1), bounded by this route's 5/hour rate limit. See ADR-0010 §7.
  if (created && access.grantId !== undefined && access.grantGenerationsUsed !== undefined) {
    const consumed = await deps.consumeQuota({
      grantId: access.grantId,
      userId: user.id,
      expectedUsed: access.grantGenerationsUsed,
    });
    await auditQuotaConsumed(deps.audit, {
      userId: user.id,
      listingId: propertyId,
      metadata: { jobId: job.id, grantId: access.grantId, consumed: consumed.consumed },
    });
  }

  await auditGenerationRequested(deps.audit, {
    userId: user.id,
    listingId: propertyId,
    metadata: { jobId: job.id, created },
  });

  // Only safe fields — no storage path, no provider, no secrets.
  return NextResponse.json({ jobId: job.id }, { status: 202 });
}

export async function POST(req: Request): Promise<Response> {
  if (!isCreativeStudioVideoEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return handleGenerateVideo(req, defaultDeps());
}
