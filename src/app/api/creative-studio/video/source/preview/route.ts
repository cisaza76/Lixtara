// GET /api/creative-studio/video/source/preview?listingId=<uuid> — owner-only, flag-gated.
// Grants a SHORT-LIVED (5 min) temporary media-access descriptor for the listing's current
// Source Video so the seller can preview it inline. The signed URL is generated SERVER-SIDE
// and is ephemeral: it is never persisted, never logged, and never a public URL. The DTO
// carries NO bucket / storagePath / separate token. Read-only: no create/mutate, no
// preparation/render, no job.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createService } from "@/lib/supabase/service";
import { SupabaseAssetStore } from "@/lib/assets/asset-store.supabase";
import type { Asset } from "@/lib/assets/types";
import { SOURCE_BUCKET, isCreativeStudioVideoEnabled, isUuid } from "@/lib/creative-studio/source-upload";
import {
  SOURCE_PREVIEW_TTL_SECONDS,
  accessExpiresAt,
  toSourcePreviewDto,
  type SourcePreviewDto,
  type TemporaryMediaAccess,
} from "@/lib/creative-studio/source-preview";
import { checkVideoAccess, videoVisibilityDenial, type CheckVideoAccess } from "@/lib/creative-studio/video-access-guard";

interface PropertyRow {
  id: string;
  owner_id: string;
}

export interface SourcePreviewDeps {
  getUser(): Promise<{ id: string } | null>;
  loadProperty(listingId: string): Promise<PropertyRow | null>;
  loadCurrentSource(listingId: string, ownerId: string): Promise<Asset | null>;
  // Mints the ephemeral signed URL server-side (never exposes bucket/path/token to the client).
  createTemporaryAccess(bucket: string, path: string): Promise<TemporaryMediaAccess | null>;
  // Gate 5 visibility: an allowlisted, in-scope seller only (quota does NOT gate previewing).
  checkAccess: CheckVideoAccess;
}

function defaultDeps(): SourcePreviewDeps {
  let clientPromise: ReturnType<typeof createClient> | null = null;
  const client = () => (clientPromise ??= createClient());
  return {
    async getUser() {
      const supabase = await client();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user ? { id: user.id } : null;
    },
    async loadProperty(listingId) {
      const supabase = await client();
      const { data } = await supabase.from("properties").select("id, owner_id").eq("id", listingId).maybeSingle();
      return (data as PropertyRow | null) ?? null;
    },
    async loadCurrentSource(listingId, ownerId) {
      const assets = new SupabaseAssetStore(createService());
      const all = await assets.listByListing(listingId);
      const uploads = all.filter((a) => a.kind === "video" && a.sourceType === "seller_upload" && a.ownerId === ownerId);
      if (uploads.length === 0) return null;
      return [...uploads].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    },
    async createTemporaryAccess(bucket, path) {
      const { data, error } = await createService().storage.from(bucket).createSignedUrl(path, SOURCE_PREVIEW_TTL_SECONDS);
      if (error || !data?.signedUrl) return null;
      return { locator: data.signedUrl, expiresAt: accessExpiresAt(Date.now()) };
    },
    checkAccess: checkVideoAccess,
  };
}

// Temporary media accesses must never be cached by the browser or any shared/proxy cache —
// each grant is short-lived and owner-scoped. Applied to EVERY response from this endpoint.
const NO_STORE = { "cache-control": "private, no-store, max-age=0" } as const;

function json(body: unknown, status: number): Response {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function handleSourcePreview(req: Request, deps: SourcePreviewDeps): Promise<Response> {
  const user = await deps.getUser();
  if (!user) return json({ error: "not_authenticated" }, 401);

  const listingId = new URL(req.url).searchParams.get("listingId") ?? "";
  if (!isUuid(listingId)) return json({ error: "listing_id_required" }, 400);

  const property = await deps.loadProperty(listingId);
  if (!property || property.owner_id !== user.id) {
    return json({ error: "listing_not_found_or_not_yours" }, 403);
  }

  // Gate 5 access (after ownership): invisible (404) to a non-allowlisted / out-of-scope seller;
  // quota does NOT gate previewing existing source (videoVisibilityDenial).
  const featureDenial = videoVisibilityDenial(await deps.checkAccess({ userId: user.id, listingId }));
  if (featureDenial) return json(featureDenial.body, featureDenial.status);

  const asset = await deps.loadCurrentSource(listingId, user.id);
  if (!asset) return json({ exists: false } satisfies SourcePreviewDto, 200);

  // Server builds the path from the Asset — the client never supplies it.
  const access = await deps.createTemporaryAccess(SOURCE_BUCKET, asset.storagePath);
  if (!access) return json({ error: "preview_unavailable" }, 503);

  return json(toSourcePreviewDto(asset, access), 200);
}

export async function GET(req: Request): Promise<Response> {
  if (!isCreativeStudioVideoEnabled()) return json({ error: "not_found" }, 404);
  return handleSourcePreview(req, defaultDeps());
}
