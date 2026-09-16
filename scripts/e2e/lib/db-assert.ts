// Lecturas y utilidades de estado para las aserciones del arnés E2E.
//
// Usa la service key porque debe observar el estado REAL (RLS lo ocultaría), pero es
// deliberadamente estrecha: solo lee, salvo tres escrituras acotadas y explícitas que el
// arnés necesita para montarse y desmontarse — crear el listing QA, crear el grant y
// revocarlo, más el borrado de los artefactos sintéticos que el propio run creó.
//
// NUNCA toca: jobs (ni históricos ni nuevos), auditoría histórica, listings reales,
// assets de otros listings, flags ni variables de entorno.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

export const QA_LISTING_MARKER = "E2E_SOURCE_LIFECYCLE";
export const VIDEO_SOURCE_REMOVED_ACTION = "creative_studio.video_source_removed";

export function service(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface AssetRow {
  id: string;
  kind: string;
  source_type: string;
  lifecycle: string;
  archived_at: string | null;
  bytes: number;
  mime: string;
  storage_path: string;
  provenance: unknown;
  created_at: string;
}

export async function listAssets(db: SupabaseClient, listingId: string): Promise<AssetRow[]> {
  const { data, error } = await db
    .from("assets")
    .select("id, kind, source_type, lifecycle, archived_at, bytes, mime, storage_path, provenance, created_at")
    .eq("listing_id", listingId)
    .order("created_at");
  if (error) throw new Error(`listAssets: ${error.message}`);
  return (data ?? []) as AssetRow[];
}

export async function countRemovalAudits(db: SupabaseClient, listingId: string, assetId?: string): Promise<number> {
  let q = db
    .from("activity_log")
    .select("id", { count: "exact", head: true })
    .eq("action_type", VIDEO_SOURCE_REMOVED_ACTION)
    .eq("property_id", listingId);
  if (assetId) q = q.eq("metadata->>assetId", assetId);
  const { count, error } = await q;
  if (error) throw new Error(`countRemovalAudits: ${error.message}`);
  return count ?? 0;
}

/** Huella global de jobs: cualquier cambio significa que el arnés tocó algo que no debía. */
export async function jobsFingerprint(db: SupabaseClient): Promise<string> {
  const { data, error, count } = await db
    .from("creative_jobs")
    .select("id, state", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(`jobsFingerprint: ${error.message}`);
  return `${count ?? 0}:${(data ?? []).map((j) => `${j.id}/${j.state}`).join(",")}`;
}

/**
 * ¿Existe el objeto en Storage? Oráculo AUTORITATIVO para "los bytes se borraron".
 *
 * No sirve descargar la URL firmada: el CDN de Supabase sigue sirviendo una copia cacheada
 * durante un tiempo después del borrado, así que un 200 ahí NO prueba que el objeto exista.
 * Lo que manda es el catálogo (`storage.objects`), que es lo que consulta `list()`.
 */
export async function objectExists(db: SupabaseClient, path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await db.storage.from("creative-studio").list(dir, { limit: 100, search: name });
  if (error) return false;
  return (data ?? []).some((o) => o.name === name);
}

export async function storageObjects(db: SupabaseClient, prefix: string): Promise<string[]> {
  const { data, error } = await db.storage.from("creative-studio").list(prefix, { limit: 100 });
  if (error) return []; // prefijo inexistente = sin objetos
  return (data ?? []).map((o) => o.name);
}

export async function quotaOf(db: SupabaseClient, grantId: string): Promise<{ used: number; max: number } | null> {
  const { data } = await db
    .from("creative_studio_video_access")
    .select("generations_used, max_generations")
    .eq("id", grantId)
    .maybeSingle();
  return data ? { used: data.generations_used as number, max: data.max_generations as number } : null;
}

/** Listing QA de la cuenta QA. Siempre draft; se crea una vez y se reutiliza. */
export async function ensureQaListing(db: SupabaseClient, ownerId: string): Promise<string> {
  const { data: existing } = await db
    .from("properties")
    .select("id, mls_status")
    .eq("owner_id", ownerId)
    .eq("address_street", QA_LISTING_MARKER)
    .maybeSingle();
  if (existing) {
    if (existing.mls_status !== "draft") {
      throw new Error(`El listing QA ${existing.id} no está en draft (${existing.mls_status}). Abortando.`);
    }
    return existing.id as string;
  }
  const { data, error } = await db
    .from("properties")
    .insert({
      owner_id: ownerId,
      // Columnas NOT NULL sin default en `properties`: owner_id, address_street,
      // address_city, address_zip, property_type, list_price.
      address_street: QA_LISTING_MARKER,
      address_city: "QA",
      address_state: "FL",
      address_zip: "00000",
      property_type: "single_family",
      list_price: 0,
      mls_status: "draft", // NUNCA active: no debe aparecer en la web pública
    })
    .select("id")
    .single();
  if (error) throw new Error(`ensureQaListing: ${error.message}`);
  return data.id as string;
}

export async function createGrant(
  db: SupabaseClient,
  input: { userId: string; listingId: string; maxGenerations: number; reason: string },
): Promise<string> {
  const { data, error } = await db
    .from("creative_studio_video_access")
    .insert({
      user_id: input.userId,
      listing_id: input.listingId,
      enabled: true,
      max_generations: input.maxGenerations,
      generations_used: 0,
      valid_from: new Date().toISOString(),
      valid_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 h: ventana mínima
      approved_by: input.userId,
      reason: input.reason,
    })
    .select("id")
    .single();
  if (error) throw new Error(`createGrant: ${error.message}`);
  return data.id as string;
}

export async function revokeGrant(db: SupabaseClient, grantId: string): Promise<void> {
  const { error } = await db
    .from("creative_studio_video_access")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId);
  if (error) throw new Error(`revokeGrant: ${error.message}`);
}

/** Revoca CUALQUIER grant vivo de la cuenta QA (pre-clean tras una interrupción). */
export async function revokeAllQaGrants(db: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await db
    .from("creative_studio_video_access")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new Error(`revokeAllQaGrants: ${error.message}`);
  return (data ?? []).length;
}

/**
 * Retira los artefactos sintéticos del listing QA: borra sus objetos de Storage y sus filas
 * de assets. Solo aplica al listing QA — nunca a un listing real. La auditoría NO se toca.
 */
export async function purgeQaArtifacts(db: SupabaseClient, listingId: string): Promise<{ objects: number; assets: number }> {
  const assets = await listAssets(db, listingId);
  const paths = assets.map((a) => a.storage_path).filter(Boolean);
  let objects = 0;
  if (paths.length > 0) {
    const { data } = await db.storage.from("creative-studio").remove(paths);
    objects = (data ?? []).length;
  }
  if (assets.length > 0) {
    const { error } = await db.from("assets").delete().eq("listing_id", listingId);
    if (error) throw new Error(`purgeQaArtifacts(assets): ${error.message}`);
  }
  return { objects, assets: assets.length };
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
