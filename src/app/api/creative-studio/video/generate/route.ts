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
import { createJob, type JobsStore } from "@/lib/creative-jobs/jobs";
import { SupabaseJobsStore } from "@/lib/creative-jobs/jobs-store.supabase";
import { buildIdempotencyKey, hashSourceAssetIds } from "@/lib/video-engine/idempotency";
import { TEMPLATE_VERSION } from "@/lib/video-engine/versions";

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
  jobsStore: JobsStore;
  now(): number;
  checkRateLimit(userId: string): Promise<Response | null>;
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

  const photoRows = await deps.loadPhotos(propertyId);
  const mediaAssets: MediaAsset[] = photoRows
    .filter((r): r is { id: string; url: string } => Boolean(r.url))
    .map((r) => ({ photoId: r.id, url: r.url }));

  const classifications = await deps.classify(mediaAssets);
  const listingApproved = property.mls_status === "active";
  const readiness = evaluateCapabilityReadiness("video", {
    photoCount: mediaAssets.length,
    scores: [], // video's readiness branch never reads ctx.scores — see readiness.ts
    classifications,
    listingApproved,
  });

  if (readiness.status !== "ready") {
    return NextResponse.json(
      { error: "not_ready", reasons: readiness.reasons, suggestedActions: readiness.suggestedActions },
      { status: 422 },
    );
  }

  // Server-built idempotency key — NEVER the client-supplied `idempotencyKey` (there is
  // none to read; `Body` has no such field). Derived entirely from the ownership-checked
  // listingId, the pinned template version, and the resolved source-photo id set.
  const sourceAssetIds = mediaAssets.map((a) => a.photoId);
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
  const job = await createJob(deps.jobsStore, {
    listingId: propertyId,
    ownerId: user.id,
    capability: "video",
    idempotencyKey,
    nowMs: deps.now(),
    traceId: crypto.randomUUID(),
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
