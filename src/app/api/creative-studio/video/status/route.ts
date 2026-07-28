// GET /api/creative-studio/video/status?property_id=<uuid> — read-only status the seller
// Creative Studio panel polls. Mirrors the DEPENDENCY-INJECTION + testable-handler
// pattern of the sibling enqueue route (@/app/api/creative-studio/video/generate/route)
// EXACTLY: exported `handleVideoStatus(req, deps)` core + `defaultDeps()` + a thin `GET`
// that flag-gates FIRST (fail-closed 404) before touching Supabase/auth.
//
// This route NEVER exposes internal state: it maps the 8-state `CreativeJobState` down
// to the 4 seller-facing `SellerVideoState` values via `mapJobStateToSeller`
// (@/lib/creative-studio/seller-video-status), and the response body carries only
// `{ state, video }` — no storage path/bucket, no error code/message, no traceId, no
// idempotencyKey, no raw job state string. A completed job whose asset can't yet be
// loaded or signed degrades to `{ state: "creating", video: null }` rather than a 500 —
// from the seller's point of view that reads as "still finishing," never "broken."
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createService } from "@/lib/supabase/service";
import { isCreativeStudioVideoEnabled } from "@/app/api/creative-studio/video/generate/route";
import type { CreativeJob } from "@/lib/creative-jobs/jobs";
import { SupabaseJobsStore } from "@/lib/creative-jobs/jobs-store.supabase";
import { SupabaseAssetStore } from "@/lib/assets/asset-store.supabase";
import type { Asset } from "@/lib/assets/types";
import { deriveSellerFailure, deriveVideoMeta, isEquivalentFailure, madeFromStrategy, mapJobStateToSeller, type SellerVideoStatusDto } from "@/lib/creative-studio/seller-video-status";
import { checkVideoAccess, videoVisibilityDenial, type CheckVideoAccess } from "@/lib/creative-studio/video-access-guard";

export { isCreativeStudioVideoEnabled };

interface PropertyRow {
  id: string;
  owner_id: string;
}

// Injected dependencies — mirrors GenerateVideoDeps so this route is unit-testable end
// to end with fakes: no real Supabase call in tests. `handleVideoStatus` below is the
// exported, directly-callable handler; `GET` only adds the flag gate + wires real deps.
export interface VideoStatusDeps {
  getUser(): Promise<{ id: string } | null>;
  loadProperty(propertyId: string): Promise<PropertyRow | null>;
  findLatestByListing(listingId: string): Promise<CreativeJob | null>;
  getAsset(assetId: string): Promise<Asset | null>;
  // Signs preview + download URLs for a completed asset. Returns null if signing is
  // unavailable (e.g. object not yet visible) — the handler degrades gracefully, never
  // 500s.
  signUrls(asset: Asset): Promise<{ previewUrl: string; downloadUrl: string } | null>;
  // Gate 5 visibility: an allowlisted, in-scope seller only (quota does NOT gate reading status).
  checkAccess: CheckVideoAccess;
  // UX 5C — the latest terminal jobs for the listing (newest first), with the failure
  // identity facts needed by the approved repetition rule. Strategy/sourceAssetId come
  // from the #112 evidence pack when present; nulls degrade the comparison gracefully.
  listRecentTerminalJobs?(listingId: string): Promise<
    Array<{ state: string; errorCode: string | null; strategy: string | null; sourceAssetId: string | null }>
  >;
}

function defaultDeps(): VideoStatusDeps {
  // Lazily memoized so a single GET only ever creates one RLS-scoped client, even though
  // getUser/loadProperty each ask for it.
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
        .select("id, owner_id")
        .eq("id", propertyId)
        .maybeSingle();
      return (data as PropertyRow | null) ?? null;
    },
    async findLatestByListing(listingId) {
      return new SupabaseJobsStore(createService()).findLatestByListing(listingId);
    },
    async getAsset(assetId) {
      return new SupabaseAssetStore(createService()).getById(assetId);
    },
    async signUrls(asset) {
      // Any signing failure — a returned `{error}`, a missing signedUrl, OR an unexpected
      // thrown network exception — degrades to null so the handler reports "still finishing"
      // instead of surfacing a 500 to the seller (honors the never-500 contract).
      try {
        const service = createService();
        const bucket = service.storage.from(asset.storageBucket);
        const [preview, download] = await Promise.all([
          bucket.createSignedUrl(asset.storagePath, 3600),
          bucket.createSignedUrl(asset.storagePath, 3600, { download: "listing-video.mp4" }),
        ]);
        const previewUrl = preview.data?.signedUrl;
        const downloadUrl = download.data?.signedUrl;
        if (preview.error || download.error || !previewUrl || !downloadUrl) return null;
        return { previewUrl, downloadUrl };
      } catch {
        return null;
      }
    },
    checkAccess: checkVideoAccess,
    async listRecentTerminalJobs(listingId) {
      // Two most recent jobs + (for failed ones) the #112 evidence facts from their
      // failed transition. Any error degrades to [] — the repetition rule then simply
      // does not fire (first-failure treatment), never a 500.
      try {
        const service = createService();
        const { data: jobs } = await service
          .from("creative_jobs")
          .select("id, state, error_code")
          .eq("listing_id", listingId)
          .eq("capability", "video")
          .order("created_at", { ascending: false })
          .limit(2);
        if (!jobs?.length) return [];
        const failedIds = jobs.filter((j) => j.state === "failed").map((j) => j.id);
        const evidenceByJob = new Map<string, { strategy: string | null; sourceAssetId: string | null }>();
        if (failedIds.length) {
          const { data: transitions } = await service
            .from("creative_job_transitions")
            .select("job_id, metadata")
            .in("job_id", failedIds)
            .eq("to_state", "failed");
          for (const t of transitions ?? []) {
            const ev = (t.metadata as { evidence?: { strategy?: string; sourceAssetId?: string } } | null)?.evidence;
            evidenceByJob.set(t.job_id as string, {
              strategy: ev?.strategy ?? null,
              sourceAssetId: ev?.sourceAssetId ?? null,
            });
          }
        }
        return jobs.map((j) => ({
          state: j.state as string,
          errorCode: (j.error_code as string | null) ?? null,
          strategy: evidenceByJob.get(j.id)?.strategy ?? null,
          sourceAssetId: evidenceByJob.get(j.id)?.sourceAssetId ?? null,
        }));
      } catch {
        return [];
      }
    },
  };
}

// The testable handler. Tests call this directly with fake deps — no real Supabase call
// — and never go through `GET`'s flag gate (that's covered separately, mirroring the
// generate route's `isCreativeStudioVideoEnabled`/`POST` split).
export async function handleVideoStatus(req: Request, deps: VideoStatusDeps): Promise<Response> {
  const user = await deps.getUser();
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const propertyId = new URL(req.url).searchParams.get("property_id");
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

  // Gate 5 access (after ownership): invisible (404) to a non-allowlisted / out-of-scope seller;
  // quota does NOT gate reading status (videoVisibilityDenial).
  const access = await deps.checkAccess({ userId: user.id, listingId: propertyId });
  const denial = videoVisibilityDenial(access);
  if (denial) return NextResponse.json(denial.body, { status: denial.status });

  const job = await deps.findLatestByListing(propertyId);
  let state = mapJobStateToSeller(job?.state ?? null);
  let video: SellerVideoStatusDto["video"] = null;
  let madeFrom: SellerVideoStatusDto["madeFrom"];
  let failure: SellerVideoStatusDto["failure"];

  if (state === "completed" && job?.assetId) {
    const asset = await deps.getAsset(job.assetId);
    const signed = asset ? await deps.signUrls(asset) : null;
    if (asset && signed) {
      video = {
        previewUrl: signed.previewUrl,
        downloadUrl: signed.downloadUrl,
        meta: deriveVideoMeta(asset),
      };
      madeFrom = madeFromStrategy(
        (asset.provenance as { sourceStrategy?: string } | null)?.sourceStrategy ?? null,
      );
    } else {
      // A completed job whose asset is missing or can't yet be signed reads as still
      // finishing, never broken — never a 500, never a "completed" state with no video.
      state = "creating";
      video = null;
    }
  }

  if (state === "failed" && job) {
    // UX 5C — approved repetition rule: only the two MOST RECENT jobs, both failed and
    // equivalent (same strategy + same source asset + same kind-or-code), count. All
    // derivation never throws; a lookup failure degrades to "first failure" treatment.
    let isRepeat = false;
    try {
      const recent = (await deps.listRecentTerminalJobs?.(propertyId)) ?? [];
      if (recent.length >= 2 && recent[0].state === "failed" && recent[1].state === "failed") {
        isRepeat = isEquivalentFailure(
          { errorCode: recent[0].errorCode, strategy: recent[0].strategy, sourceAssetId: recent[0].sourceAssetId },
          { errorCode: recent[1].errorCode, strategy: recent[1].strategy, sourceAssetId: recent[1].sourceAssetId },
        );
      }
    } catch {
      isRepeat = false;
    }
    failure = deriveSellerFailure({
      errorCode: job.errorCode ?? null,
      traceId: job.traceId ?? null,
      remainingGenerations: access.remainingGenerations,
      isRepeatEquivalentFailure: isRepeat,
    });
  }

  const dto: SellerVideoStatusDto = { state, video, ...(madeFrom ? { madeFrom } : {}), ...(failure ? { failure } : {}) };
  return NextResponse.json(dto, { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  if (!isCreativeStudioVideoEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return handleVideoStatus(req, defaultDeps());
}
