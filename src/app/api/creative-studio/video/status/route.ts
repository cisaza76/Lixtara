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
import { mapJobStateToSeller, deriveVideoMeta, type SellerVideoStatusDto } from "@/lib/creative-studio/seller-video-status";

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

  const job = await deps.findLatestByListing(propertyId);
  let state = mapJobStateToSeller(job?.state ?? null);
  let video: SellerVideoStatusDto["video"] = null;

  if (state === "completed" && job?.assetId) {
    const asset = await deps.getAsset(job.assetId);
    const signed = asset ? await deps.signUrls(asset) : null;
    if (asset && signed) {
      video = {
        previewUrl: signed.previewUrl,
        downloadUrl: signed.downloadUrl,
        meta: deriveVideoMeta(asset),
      };
    } else {
      // A completed job whose asset is missing or can't yet be signed reads as still
      // finishing, never broken — never a 500, never a "completed" state with no video.
      state = "creating";
      video = null;
    }
  }

  const dto: SellerVideoStatusDto = { state, video };
  return NextResponse.json(dto, { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  if (!isCreativeStudioVideoEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return handleVideoStatus(req, defaultDeps());
}
