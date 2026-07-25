// The persistence port for render output bytes — decouples `produceVideoAsset` from
// Supabase Storage specifics (per the Asset Manager design's storage decision: Supabase
// Storage is the single source of truth for renders too — see
// docs/superpowers/specs/2026-07-15-asset-manager-design.md §6). A Supabase-backed impl
// runs behind it for the real path; `createFakeStoragePort` is what every unit test
// uses (produce-asset.test.ts) — no network, no bucket, in-memory only.
import { createService } from "@/lib/supabase/service";

export interface UploadedObject {
  bucket: string;
  path: string;
  bytes: number;
}

export interface StoragePort {
  upload(path: string, bytes: Buffer, contentType: string): Promise<UploadedObject>;
  // Signed-url readable check — proves the object is actually retrievable, not just
  // that the upload call returned success (belt-and-suspenders before an Asset row
  // ever points at it).
  readVerify(bucket: string, path: string): Promise<boolean>;
  // Orphan cleanup: called when an upload succeeded but Asset creation failed.
  remove(bucket: string, path: string): Promise<void>;
}

// Video renders live in their own bucket, separate from seller-uploaded
// `property-photos` (src/lib/storage.ts) — different retention/access shape, and
// keeping them apart avoids any chance of a render write colliding with an upload path.
export const RENDER_BUCKET = "creative-renders";

// Real integration: Supabase Storage via the service-role client (this runs from a
// worker/orchestrator context — src/lib/creative-jobs — with no user session/cookies to
// read, so the RSC/browser clients in @/lib/supabase don't apply here).
export class SupabaseStoragePort implements StoragePort {
  constructor(private readonly bucket: string = RENDER_BUCKET) {}

  async upload(path: string, bytes: Buffer, contentType: string): Promise<UploadedObject> {
    const supabase = createService();
    const { error } = await supabase.storage.from(this.bucket).upload(path, bytes, {
      contentType,
      upsert: false,
    });
    if (error) throw error;
    return { bucket: this.bucket, path, bytes: bytes.length };
  }

  async readVerify(bucket: string, path: string): Promise<boolean> {
    const supabase = createService();
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) return false;
    try {
      const res = await fetch(data.signedUrl, { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }

  async remove(bucket: string, path: string): Promise<void> {
    const supabase = createService();
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) throw error;
  }
}

export interface FakeStoragePort extends StoragePort {
  // Test introspection — every test in produce-asset.test.ts asserts against these
  // instead of mocking modules.
  readonly uploaded: Array<{ path: string; bytes: Buffer; contentType: string }>;
  readonly removed: Array<{ bucket: string; path: string }>;
  readonly readVerifyCalls: Array<{ bucket: string; path: string }>;
}

export interface FakeStoragePortOptions {
  bucket?: string;
  // Injectable failure hooks so tests can force each failure mode without mocking
  // modules — e.g. "upload fail -> no Asset" and "orphan cleanup" tests.
  failUpload?: boolean;
  failReadVerify?: boolean;
  failRemove?: boolean;
}

// In-memory fake — used by ALL unit tests. No real bucket, no network.
export function createFakeStoragePort(opts: FakeStoragePortOptions = {}): FakeStoragePort {
  const bucket = opts.bucket ?? RENDER_BUCKET;
  const objects = new Map<string, Buffer>();
  const uploaded: FakeStoragePort["uploaded"] = [];
  const removed: FakeStoragePort["removed"] = [];
  const readVerifyCalls: FakeStoragePort["readVerifyCalls"] = [];

  return {
    uploaded,
    removed,
    readVerifyCalls,
    async upload(path, bytes, contentType) {
      if (opts.failUpload) throw new Error("fake storage: upload failed");
      uploaded.push({ path, bytes, contentType });
      objects.set(path, bytes);
      return { bucket, path, bytes: bytes.length };
    },
    async readVerify(b, path) {
      readVerifyCalls.push({ bucket: b, path });
      if (opts.failReadVerify) return false;
      return objects.has(path);
    },
    async remove(b, path) {
      if (opts.failRemove) throw new Error("fake storage: remove failed");
      removed.push({ bucket: b, path });
      objects.delete(path);
    },
  };
}
