// F4.4 — pure contract + helpers for the Source Video preview. No I/O, no Supabase, no
// React. The DTO models a TEMPORARY MEDIA-ACCESS DESCRIPTOR, deliberately NOT named/typed as
// a "preview URL": today it is backed by a short-lived signed URL, but the client must treat
// `access` as an OPAQUE, EXPIRING grant — never a stable/public URL, never persisted, never
// assumed valid past `expiresAt`, never coupled to the signed-URL mechanism. The DTO never
// carries bucket / storagePath / a separate token.
import type { Asset } from "@/lib/assets/types";

// Short-lived by design (adjust: 5 minutes). Renewed reactively on demand, never on a timer.
export const SOURCE_PREVIEW_TTL_SECONDS = 300;

// A temporary, expiring grant to play the media. Opaque to the client. `locator` is a
// deliberately mechanism-neutral name: today it is backed by a short-lived signed URL, but the
// client must treat it as an opaque, expiring handle — never a stable/public URL, never
// persisted, never assumed valid past `expiresAt`. Renaming away from `url` keeps the contract
// from leaking the concrete access mechanism (see ADR-0008).
export interface TemporaryMediaAccess {
  locator: string; // implementation detail (currently a signed URL); treat as opaque + expiring
  expiresAt: string; // ISO — after this the grant is invalid and must be renewed
}

export interface SourcePreviewMeta {
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  // null server-side: the source has not been through F3's `validating` stage (ffprobe), so
  // duration is unknown here. The UI may read it client-side from the <video> element. Server-
  // side duration is out of F4.4 scope (would require preparation).
  durationSeconds: number | null;
}

export interface SourcePreviewDto {
  exists: boolean;
  preview?: {
    access: TemporaryMediaAccess;
    meta: SourcePreviewMeta;
  };
}

export function toSourcePreviewDto(asset: Asset | null, access: TemporaryMediaAccess | null): SourcePreviewDto {
  if (!asset || !access) return { exists: false };
  return {
    exists: true,
    preview: {
      access,
      meta: {
        mimeType: asset.mime,
        sizeBytes: asset.bytes,
        uploadedAt: asset.createdAt,
        durationSeconds: null,
      },
    },
  };
}

// Reactive-renewal decision (NO client timers): the caller renews only when it is about to
// use the access (a play request) or when playback failed. A small negative skew treats the
// grant as expired slightly early so a request never starts against a just-expired URL. Pure.
export function isAccessExpired(access: TemporaryMediaAccess | null, nowMs: number, skewMs = 5000): boolean {
  if (!access) return true;
  const t = Date.parse(access.expiresAt);
  return !Number.isFinite(t) || nowMs >= t - skewMs;
}

// Server helper: compute expiresAt from a TTL. Kept pure (nowMs injected) for testability.
export function accessExpiresAt(nowMs: number, ttlSeconds: number = SOURCE_PREVIEW_TTL_SECONDS): string {
  return new Date(nowMs + ttlSeconds * 1000).toISOString();
}
