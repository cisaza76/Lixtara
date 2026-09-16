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
import { defaultResolveVideoSource } from "@/lib/video-engine/resolve-video-source";
import type { Asset } from "@/lib/assets/types";
import { isCreativeStudioVideoEnabled, isUuid } from "@/lib/creative-studio/source-upload";
import { toSellerSourceDto, type SellerSourceDto } from "@/lib/creative-studio/seller-source-status";
import { checkVideoAccess, videoVisibilityDenial, type CheckVideoAccess } from "@/lib/creative-studio/video-access-guard";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";
import {
  removeCurrentSource,
  VIDEO_SOURCE_REMOVED_ACTION,
  type SourceRemovalDeps,
} from "@/lib/creative-studio/source-removal";

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
  // Gate 5 visibility: an allowlisted, in-scope seller only (quota does NOT gate reading source).
  checkAccess: CheckVideoAccess;
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
    // Issue #118 — se delega en la AUTORIDAD ÚNICA en vez de reimplementar la regla. Esta
    // ruta tenía una copia del filtro+orden que, al no mirar `lifecycle`, seguía resolviendo
    // sources archivados incluso después de arreglar el resolver canónico.
    loadCurrentSource: defaultResolveVideoSource(new SupabaseAssetStore(createService())),
    checkAccess: checkVideoAccess,
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

  // Gate 5 access (after ownership): invisible (404) to a non-allowlisted / out-of-scope seller;
  // quota does NOT gate reading source status (videoVisibilityDenial).
  const denial = videoVisibilityDenial(await deps.checkAccess({ userId: user.id, listingId }));
  if (denial) return NextResponse.json(denial.body, { status: denial.status });

  const asset = await deps.loadCurrentSource(listingId, user.id);
  const dto: SellerSourceDto = toSellerSourceDto(asset);
  return NextResponse.json(dto, { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  if (!isCreativeStudioVideoEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return handleReadSource(req, defaultDeps());
}

// ---------------------------------------------------------------------------------------
// DELETE /api/creative-studio/video/source?listingId=<uuid> — el vendedor elimina SU source.
//
// Mismas puertas que GET (flag → auth → ownership → visibilidad de Gate 5) más un limitador,
// por ser mutación. Elimina EXCLUSIVAMENTE el source vigente: jamás un asset generado, jamás
// un job, jamás la cuota/grant. La semántica (archivar → borrar bytes → conservar fila y
// provenance → auditar) vive en el módulo puro source-removal.ts.
// ---------------------------------------------------------------------------------------

export interface SourceRemoveDeps extends SourceReadDeps {
  checkRateLimit(userId: string): Promise<Response | null>;
  removal: Omit<SourceRemovalDeps, "resolveCurrent">;
}

function removeDeps(): SourceRemoveDeps {
  const base = defaultDeps();
  return {
    ...base,
    async checkRateLimit(userId) {
      return enforceLimit(apiLimiter("creative-studio:video:source:remove", 20, "1 h"), `u:${userId}`, {
        label: "creative-studio:video:source:remove",
        message: "Too many requests. Please wait.",
      });
    },
    removal: {
      // UPDATE condicional: los tres guards viven en el WHERE, así que la atomicidad es de
      // Postgres. 1 fila = esta llamada archivó; 0 filas = ya estaba archivado o no es suya.
      async archive({ assetId, ownerId }) {
        const { data, error } = await createService()
          .from("assets")
          .update({ lifecycle: "archived", archived_at: new Date().toISOString() })
          .eq("id", assetId)
          .eq("owner_id", ownerId)
          .neq("lifecycle", "archived")
          .select("id");
        if (error) throw new Error(`source archive failed: ${error.message ?? "unknown"}`);
        if (((data as { id: string }[] | null) ?? []).length === 1) return "archived";
        const { data: row } = await createService()
          .from("assets")
          .select("id")
          .eq("id", assetId)
          .eq("owner_id", ownerId)
          .limit(1)
          .maybeSingle();
        return row ? "already_archived" : "not_found";
      },
      // Nunca lanza: un fallo de Storage no invalida el archivado (la retención recupera el
      // objeto huérfano más tarde).
      async deleteObject(bucket, path) {
        try {
          const { error } = await createService().storage.from(bucket).remove([path]);
          return !error;
        } catch {
          return false;
        }
      },
      audit: {
        async exists({ userId, listingId, assetId }) {
          const { data } = await createService()
            .from("activity_log")
            .select("id")
            .eq("action_type", VIDEO_SOURCE_REMOVED_ACTION)
            .eq("user_id", userId)
            .eq("property_id", listingId)
            .eq("metadata->>assetId", assetId)
            .limit(1)
            .maybeSingle();
          return Boolean(data);
        },
        async insert({ userId, listingId, assetId }) {
          // Solo identificadores: ninguna URL firmada, token ni ruta de Storage.
          const { error } = await createService().from("activity_log").insert({
            user_id: userId,
            property_id: listingId,
            action_type: VIDEO_SOURCE_REMOVED_ACTION,
            description: "Seller removed their source video",
            metadata: { assetId },
          });
          if (error) throw new Error(`removal audit insert failed: ${error.message ?? "unknown"}`);
        },
      },
    },
  };
}

export async function handleRemoveSource(req: Request, deps: SourceRemoveDeps): Promise<Response> {
  const user = await deps.getUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const limited = await deps.checkRateLimit(user.id);
  if (limited) return limited;

  const listingId = new URL(req.url).searchParams.get("listingId") ?? "";
  if (!isUuid(listingId)) return NextResponse.json({ error: "listing_id_required" }, { status: 400 });

  const property = await deps.loadProperty(listingId);
  if (!property || property.owner_id !== user.id) {
    return NextResponse.json({ error: "listing_not_found_or_not_yours" }, { status: 403 });
  }

  const denial = videoVisibilityDenial(await deps.checkAccess({ userId: user.id, listingId }));
  if (denial) return NextResponse.json(denial.body, { status: denial.status });

  // `resolveCurrent` es el mismo loadCurrentSource del GET: la autoridad única, que ya excluye
  // archivados (#118) y está acotada a (listing, owner) — el aislamiento no se reimplementa.
  const result = await removeCurrentSource(
    { ...deps.removal, resolveCurrent: deps.loadCurrentSource },
    { userId: user.id, listingId },
  );
  return NextResponse.json(result, { status: 200 });
}

export async function DELETE(req: Request): Promise<Response> {
  if (!isCreativeStudioVideoEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return handleRemoveSource(req, removeDeps());
}
