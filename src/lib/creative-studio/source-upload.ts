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

// Only what VIDEO_SOURCE_LIMITS.container guarantees (mp4). Declared explicitly, not generic.
export const ALLOWED_SOURCE_MIME = ["video/mp4"] as const;
export const ALLOWED_SOURCE_EXT = ["mp4"] as const;

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
export function buildSourceStoragePath(ownerId: string, listingId: string, assetId: string): string {
  return `${SOURCE_PREFIX}/${ownerId}/${listingId}/${assetId}/source.mp4`;
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
  return path === buildSourceStoragePath(ownerId, listingId, assetId);
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
