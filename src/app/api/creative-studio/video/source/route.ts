// GET /api/creative-studio/video/source?listingId=<uuid> — read-only current Source Video
// for a listing. Auth + owner-only + flag-gated. Returns the seller-facing DTO only
// (seller-source-status.ts): NO storage path/bucket, NO signed URL/token, NO internal Asset
// fields. It NEVER creates/mutates anything and NEVER starts preparation/render.
//
// The "current source" selection mirrors F3's resolveVideoSource policy (newest
// seller-upload video for the owner) READ-ONLY — worker-deps/resolveVideoSource are NOT
// touched (F3/F4.2 frozen).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createService } from "@/lib/supabase/service";
import { SupabaseAssetStore } from "@/lib/assets/asset-store.supabase";
import type { Asset } from "@/lib/assets/types";
import { isCreativeStudioVideoEnabled, isUuid } from "@/lib/creative-studio/source-upload";
import { toSellerSourceDto, type SellerSourceDto } from "@/lib/creative-studio/seller-source-status";

interface PropertyRow {
  id: string;
  owner_id: string;
}

export interface SourceReadDeps {
  getUser(): Promise<{ id: string } | null>;
  loadProperty(listingId: string): Promise<PropertyRow | null>;
  // Newest seller-upload video Asset for (listing, owner), or null — the read-only mirror of
  // resolveVideoSource's selection policy.
  loadCurrentSource(listingId: string, ownerId: string): Promise<Asset | null>;
}

function defaultDeps(): SourceReadDeps {
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
  };
}

export async function handleReadSource(req: Request, deps: SourceReadDeps): Promise<Response> {
  const user = await deps.getUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const listingId = new URL(req.url).searchParams.get("listingId") ?? "";
  if (!isUuid(listingId)) return NextResponse.json({ error: "listing_id_required" }, { status: 400 });

  const property = await deps.loadProperty(listingId);
  if (!property || property.owner_id !== user.id) {
    return NextResponse.json({ error: "listing_not_found_or_not_yours" }, { status: 403 });
  }

  const asset = await deps.loadCurrentSource(listingId, user.id);
  const dto: SellerSourceDto = toSellerSourceDto(asset);
  return NextResponse.json(dto, { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  if (!isCreativeStudioVideoEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return handleReadSource(req, defaultDeps());
}
