// Supabase Storage-backed StoragePort for Creative Studio video renders — a PRIVATE
// bucket (never public; every read goes through a short-lived signed URL, never a
// public URL). Separate from `RENDER_BUCKET` ("creative-renders", the existing
// SupabaseStoragePort in storage-port.ts) — this is the Creative Studio P2 bucket per
// docs/superpowers/specs/2026-07-15-asset-manager-design.md §6. CODE ONLY: the bucket
// itself is NOT created by this file — that's an owner action.
//
// Structural client: only the `.storage` chain shape this file actually calls. Unlike
// asset-store.supabase.ts / jobs-store.supabase.ts's Postgrest builders (which had to
// switch to the real SupabaseClient type + per-call narrowing to avoid TS2589 — see
// those files), the Storage surface here is plain, non-recursive async signatures, so a
// real Supabase client (createService()) genuinely does satisfy `StorageDbClient`
// structurally, and a test fake needs no SDK import — just an object literal cast with
// `as never` at the call site.
import type { StoragePort, UploadedObject } from "@/lib/video-engine/storage-port";

// Owner can override via env (e.g. a staging bucket name) without a code change; falls
// back to the canonical private bucket name.
export const CREATIVE_STUDIO_BUCKET = process.env.CREATIVE_STUDIO_BUCKET_NAME ?? "creative-studio";

const ALLOWED_CONTENT_TYPE = "video/mp4";

// Hard ceiling against a runaway/misconfigured render — a listing video assembled from
// a handful of stills is nowhere near this. This isn't a precision limit, just a fail-
// fast guard against something clearly wrong reaching Storage at all.
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB

const DEFAULT_SIGNED_URL_TTL_SECONDS = 60;

export class InvalidUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUploadError";
  }
}

export interface VideoAssetPathInput {
  ownerId: string;
  listingId: string;
  assetId: string;
  version: number;
}

// Deterministic object key for a video Asset's render output — built ONLY from opaque
// ids and an integer version. NEVER the property address, seller name, or any other
// PII: the bucket is private, but the key itself must stay safe to log, paste into a
// support ticket, or show in an admin tool regardless. Bucket and path are separate
// (mirrors Asset.storageBucket/storagePath in src/lib/assets/types.ts) — the full
// location is `${CREATIVE_STUDIO_BUCKET}/${videoAssetPath(...)}`.
export function videoAssetPath({ ownerId, listingId, assetId, version }: VideoAssetPathInput): string {
  return `${ownerId}/${listingId}/${assetId}/v${version}/listing-video.mp4`;
}

type StorageError = { message?: string } | null;

interface SignedUrlResult {
  data: { signedUrl: string } | null;
  error: StorageError;
}

interface ObjectOpResult {
  data: unknown;
  error: StorageError;
}

// Structural subset of the supabase client's `.storage` surface this file relies on.
export interface StorageDbClient {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Buffer,
        opts: { contentType: string; upsert: boolean },
      ): Promise<ObjectOpResult>;
      createSignedUrl(path: string, expiresInSeconds: number): Promise<SignedUrlResult>;
      remove(paths: string[]): Promise<ObjectOpResult>;
    };
  };
}

export interface SupabaseVideoStoragePortOptions {
  bucket?: string;
  // Injected so tests never hit real network for the readVerify HEAD request.
  fetchImpl?: typeof fetch;
  signedUrlTtlSeconds?: number;
}

// Real integration: Supabase Storage via the service-role client (server/worker context
// only — see src/lib/supabase/service.ts). Validates MIME + size BEFORE ever calling
// Storage (requirement: reject bad uploads without spending a network round-trip).
export class SupabaseVideoStoragePort implements StoragePort {
  private readonly bucket: string;
  private readonly fetchImpl: typeof fetch;
  private readonly signedUrlTtlSeconds: number;

  constructor(
    private readonly client: StorageDbClient,
    opts: SupabaseVideoStoragePortOptions = {},
  ) {
    this.bucket = opts.bucket ?? CREATIVE_STUDIO_BUCKET;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.signedUrlTtlSeconds = opts.signedUrlTtlSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS;
  }

  async upload(path: string, bytes: Buffer, contentType: string): Promise<UploadedObject> {
    if (contentType !== ALLOWED_CONTENT_TYPE) {
      throw new InvalidUploadError(`unsupported content type for a video Asset: ${contentType}`);
    }
    if (bytes.length > MAX_VIDEO_BYTES) {
      throw new InvalidUploadError(
        `upload exceeds max size (${bytes.length} bytes > ${MAX_VIDEO_BYTES} bytes)`,
      );
    }
    const { error } = await this.client.storage.from(this.bucket).upload(path, bytes, {
      contentType,
      upsert: false,
    });
    if (error) throw new Error(`creative-studio upload failed: ${error.message ?? "unknown error"}`);
    return { bucket: this.bucket, path, bytes: bytes.length };
  }

  // Signed-url readable check — proves the object is actually retrievable, not just
  // that the upload call returned success. Never a public URL: always short-lived.
  async readVerify(bucket: string, path: string): Promise<boolean> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(path, this.signedUrlTtlSeconds);
    if (error || !data?.signedUrl) return false;
    try {
      const res = await this.fetchImpl(data.signedUrl, { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Orphan cleanup: called when an upload succeeded but Asset creation failed.
  async remove(bucket: string, path: string): Promise<void> {
    const { error } = await this.client.storage.from(bucket).remove([path]);
    if (error) throw new Error(`creative-studio remove failed: ${error.message ?? "unknown error"}`);
  }
}
