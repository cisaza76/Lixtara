// F4.1 — pure logic for the seller source-video upload (two-phase: initiate → direct
// upload → complete). NO Supabase/Storage/network here — just validation, the
// server-owned storage-path namespace, path-security checks, and the idempotency identity.
// The routes inject the real Supabase/Storage collaborators.
//
// Reuses F3's frozen limits (VIDEO_SOURCE_LIMITS) — no magic numbers. Only the container
// the pipeline actually supports (MP4/H.264) is accepted; MOV/HEVC are NOT declared until
// the pipeline + tests back them.
import { VIDEO_SOURCE_LIMITS } from "@/lib/video-engine/video-source-limits";

// Reuse the existing private Creative Studio bucket — logical separation by prefix, not a
// new bucket (owner decision, F4.1).
export const SOURCE_BUCKET = "creative-studio";
export const SOURCE_PREFIX = "source";
// F3's source strategy consumes exactly this — do NOT change resolveVideoSource.
export const SOURCE_ASSET_KIND = "video" as const;
export const SOURCE_ASSET_SOURCE_TYPE = "seller_upload" as const;

// Etapa 1 (autorizado 2026-08-05): MP4 y MOV/QuickTime — los dos contenedores que las
// cámaras de teléfono producen de fábrica (iPhone graba .mov). Declarados explícitamente,
// nunca genéricos. Este par es solo un filtro barato de primera línea: la AUTORIDAD real
// sobre el contenido sigue siendo ffprobe en el pipeline (checkSourceLimits), que es quien
// puede desmentir una extensión o un MIME mentirosos.
export const ALLOWED_SOURCE_MIME = ["video/mp4", "video/quicktime"] as const;
export const ALLOWED_SOURCE_EXT = ["mp4", "mov"] as const;
export type SourceExt = (typeof ALLOWED_SOURCE_EXT)[number];

// Extensión normalizada (IMG_6371.MOV → "mov") o null si no está en el set cerrado.
export function sourceExtFromFileName(fileName: unknown): SourceExt | null {
  if (typeof fileName !== "string") return null;
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  return (ALLOWED_SOURCE_EXT as readonly string[]).includes(ext) ? (ext as SourceExt) : null;
}

// Content-type que el PUT firmado debe declarar para cada contenedor. Nunca se etiqueta un
// MOV como MP4 (requisito del owner: no falsear el contenedor del input).
export function mimeForSourceExt(ext: SourceExt): (typeof ALLOWED_SOURCE_MIME)[number] {
  return ext === "mov" ? "video/quicktime" : "video/mp4";
}

export function isCreativeStudioVideoEnabled(): boolean {
  return process.env.CREATIVE_STUDIO_VIDEO_ENABLED === "true";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// Server-built object key — the client NEVER chooses this. Only opaque ids + a fixed
// filename, so the key is safe to log / show in support tooling regardless of the bucket
// being private.
export function buildSourceStoragePath(
  ownerId: string,
  listingId: string,
  assetId: string,
  ext: SourceExt = "mp4",
): string {
  return `${SOURCE_PREFIX}/${ownerId}/${listingId}/${assetId}/source.${ext}`;
}

export interface InitiateInput {
  listingId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
}
export type InitiateValidationError =
  | "listing_id_required"
  | "invalid_mime"
  | "invalid_extension"
  | "size_required"
  | "empty_file"
  | "file_too_large";

export function validateInitiate(input: InitiateInput): { ok: true } | { ok: false; error: InitiateValidationError } {
  if (!isUuid(input.listingId)) return { ok: false, error: "listing_id_required" };
  if (typeof input.mimeType !== "string" || !(ALLOWED_SOURCE_MIME as readonly string[]).includes(input.mimeType)) {
    return { ok: false, error: "invalid_mime" };
  }
  const ext = typeof input.fileName === "string" ? (input.fileName.split(".").pop() ?? "").toLowerCase() : "";
  if (!(ALLOWED_SOURCE_EXT as readonly string[]).includes(ext)) return { ok: false, error: "invalid_extension" };
  if (typeof input.sizeBytes !== "number" || !Number.isFinite(input.sizeBytes)) return { ok: false, error: "size_required" };
  if (input.sizeBytes <= 0) return { ok: false, error: "empty_file" };
  if (input.sizeBytes > VIDEO_SOURCE_LIMITS.maxFileBytes) return { ok: false, error: "file_too_large" };
  return { ok: true };
}

// Path-security gate for /complete: the client-provided path must EXACTLY equal the
// server-reconstructed namespace for (owner, listing, assetId). Rejects traversal, other
// owners' ids, other listings, arbitrary buckets/keys, and overwrite of a different asset.
export function isExpectedSourcePath(path: unknown, ownerId: string, listingId: string, assetId: string): boolean {
  if (typeof path !== "string") return false;
  if (path.includes("..") || path.includes("\0")) return false;
  // El servidor sigue siendo dueño de TODO el key: lo único que varía es la extensión,
  // dentro del set cerrado ALLOWED_SOURCE_EXT. El cliente nunca elige el nombre.
  return ALLOWED_SOURCE_EXT.some((ext) => path === buildSourceStoragePath(ownerId, listingId, assetId, ext));
}

// Extensión implícita en un path server-built ya validado (para derivar el MIME de
// fallback sin volver a confiar en el cliente).
export function sourceExtFromStoragePath(path: string): SourceExt {
  return path.endsWith(".mov") ? "mov" : "mp4";
}

// Idempotency identity for the Source Asset: (source_type, source_id) with source_id =
// the initiate-issued assetId. Backed by the existing `assets_source_unique` partial unique
// index, so a repeated /complete converges on the same row instead of duplicating.
export function sourceAssetIdentity(assetId: string): { sourceType: string; sourceId: string } {
  return { sourceType: SOURCE_ASSET_SOURCE_TYPE, sourceId: assetId };
}

// Real (stored) object metadata check — size/mime from Storage, never from the client.
export interface StoredObjectMeta {
  exists: boolean;
  sizeBytes: number;
  mimeType: string | null;
}
export type CompleteObjectError = "object_not_found" | "empty_file" | "file_too_large" | "invalid_mime";
export function validateStoredObject(meta: StoredObjectMeta): { ok: true } | { ok: false; error: CompleteObjectError } {
  if (!meta.exists) return { ok: false, error: "object_not_found" };
  if (!(meta.sizeBytes > 0)) return { ok: false, error: "empty_file" };
  if (meta.sizeBytes > VIDEO_SOURCE_LIMITS.maxFileBytes) return { ok: false, error: "file_too_large" };
  // Stored content-type must be the accepted one (defense-in-depth; the deep technical
  // validation still happens in F3's `validating` stage via ffprobe).
  if (meta.mimeType !== null && !(ALLOWED_SOURCE_MIME as readonly string[]).includes(meta.mimeType)) {
    return { ok: false, error: "invalid_mime" };
  }
  return { ok: true };
}
