import { describe, it, expect, vi } from "vitest";
import {
  SupabaseVideoStoragePort,
  videoAssetPath,
  CREATIVE_STUDIO_BUCKET,
  MAX_VIDEO_BYTES,
  InvalidUploadError,
} from "@/lib/video-engine/storage-adapter.supabase";

// Minimal hand-written fake of the supabase `.storage.from(bucket)` surface. No
// network: upload/createSignedUrl/remove all resolve synchronously from canned
// results, and `fetchImpl` (readVerify's HEAD request) is injected per-test.
function fakeClient(
  opts: {
    uploadError?: { message?: string } | null;
    signedUrl?: string | null;
    signedUrlError?: { message?: string } | null;
    removeError?: { message?: string } | null;
  } = {},
) {
  const bucketClient = {
    upload: vi.fn(async (..._args: unknown[]) => ({
      data: opts.uploadError ? null : {},
      error: opts.uploadError ?? null,
    })),
    createSignedUrl: vi.fn(async (..._args: unknown[]) => {
      if (opts.signedUrlError) return { data: null, error: opts.signedUrlError };
      return { data: { signedUrl: opts.signedUrl ?? "https://signed.example/x" }, error: null };
    }),
    remove: vi.fn(async (..._args: unknown[]) => ({
      data: opts.removeError ? null : {},
      error: opts.removeError ?? null,
    })),
  };
  const from = vi.fn((_bucket: string) => bucketClient);
  return { client: { storage: { from } }, from, bucketClient };
}

describe("videoAssetPath", () => {
  it("builds the deterministic ownerId/listingId/assetId/vN/listing-video.mp4 template", () => {
    const p = videoAssetPath({ ownerId: "O1", listingId: "L1", assetId: "A1", version: 2 });
    expect(p).toBe("O1/L1/A1/v2/listing-video.mp4");
  });

  it("contains no address/PII — only the four opaque/known segments", () => {
    const p = videoAssetPath({
      ownerId: "owner-uuid-1234",
      listingId: "listing-uuid-5678",
      assetId: "asset-uuid-9012",
      version: 1,
    });
    expect(p.split("/")).toEqual([
      "owner-uuid-1234",
      "listing-uuid-5678",
      "asset-uuid-9012",
      "v1",
      "listing-video.mp4",
    ]);
    // No free-text segment could smuggle an address/name in: every segment is either
    // a caller-supplied opaque id, "vN", or the fixed filename.
    expect(p).not.toMatch(/\s/);
  });
});

describe("SupabaseVideoStoragePort.upload", () => {
  it("uploads to the private bucket and returns {bucket, path, bytes}", async () => {
    const { client, bucketClient } = fakeClient();
    const port = new SupabaseVideoStoragePort(client as never);
    const bytes = Buffer.from("fake-mp4-bytes");
    const result = await port.upload("O1/L1/A1/v1/listing-video.mp4", bytes, "video/mp4");
    expect(result).toEqual({
      bucket: CREATIVE_STUDIO_BUCKET,
      path: "O1/L1/A1/v1/listing-video.mp4",
      bytes: bytes.length,
    });
    expect(bucketClient.upload).toHaveBeenCalledWith(
      "O1/L1/A1/v1/listing-video.mp4",
      bytes,
      expect.objectContaining({ contentType: "video/mp4", upsert: false }),
    );
  });

  it("rejects a non-mp4 content type BEFORE ever calling storage.upload", async () => {
    const { client, bucketClient } = fakeClient();
    const port = new SupabaseVideoStoragePort(client as never);
    await expect(port.upload("p", Buffer.from("x"), "image/png")).rejects.toThrow(InvalidUploadError);
    expect(bucketClient.upload).not.toHaveBeenCalled();
  });

  it("rejects an oversized upload BEFORE ever calling storage.upload", async () => {
    const { client, bucketClient } = fakeClient();
    const port = new SupabaseVideoStoragePort(client as never);
    const oversized = Buffer.alloc(MAX_VIDEO_BYTES + 1);
    await expect(port.upload("p", oversized, "video/mp4")).rejects.toThrow(InvalidUploadError);
    expect(bucketClient.upload).not.toHaveBeenCalled();
  });

  it("surfaces a storage error", async () => {
    const { client } = fakeClient({ uploadError: { message: "bucket not found" } });
    const port = new SupabaseVideoStoragePort(client as never);
    await expect(port.upload("p", Buffer.from("x"), "video/mp4")).rejects.toThrow(/bucket not found/);
  });
});

describe("SupabaseVideoStoragePort.readVerify", () => {
  it("creates a short-lived signed URL and confirms it's retrievable via the injected fetch (HEAD)", async () => {
    const { client, bucketClient } = fakeClient({ signedUrl: "https://signed.example/ok" });
    const fetchImpl = vi.fn(async () => ({ ok: true }) as Response);
    const port = new SupabaseVideoStoragePort(client as never, { fetchImpl });
    const ok = await port.readVerify(CREATIVE_STUDIO_BUCKET, "O1/L1/A1/v1/listing-video.mp4");
    expect(ok).toBe(true);
    expect(bucketClient.createSignedUrl).toHaveBeenCalledWith(
      "O1/L1/A1/v1/listing-video.mp4",
      expect.any(Number),
    );
    expect(fetchImpl).toHaveBeenCalledWith("https://signed.example/ok", { method: "HEAD" });
  });

  it("returns false (never throws) when creating the signed URL fails", async () => {
    const { client } = fakeClient({ signedUrlError: { message: "not found" } });
    const fetchImpl = vi.fn();
    const port = new SupabaseVideoStoragePort(client as never, { fetchImpl: fetchImpl as never });
    const ok = await port.readVerify(CREATIVE_STUDIO_BUCKET, "missing.mp4");
    expect(ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns false when the injected fetch rejects (no real network involved)", async () => {
    const { client } = fakeClient({ signedUrl: "https://signed.example/x" });
    const fetchImpl = vi.fn(async () => {
      throw new Error("simulated network failure");
    });
    const port = new SupabaseVideoStoragePort(client as never, { fetchImpl });
    expect(await port.readVerify(CREATIVE_STUDIO_BUCKET, "x.mp4")).toBe(false);
  });

  it("returns false when the HEAD response is not ok", async () => {
    const { client } = fakeClient({ signedUrl: "https://signed.example/x" });
    const fetchImpl = vi.fn(async () => ({ ok: false }) as Response);
    const port = new SupabaseVideoStoragePort(client as never, { fetchImpl });
    expect(await port.readVerify(CREATIVE_STUDIO_BUCKET, "x.mp4")).toBe(false);
  });
});

describe("SupabaseVideoStoragePort.remove", () => {
  it("targets the exact bucket + path for orphan cleanup", async () => {
    const { client, from, bucketClient } = fakeClient();
    const port = new SupabaseVideoStoragePort(client as never);
    await port.remove(CREATIVE_STUDIO_BUCKET, "O1/L1/A1/v1/listing-video.mp4");
    expect(from).toHaveBeenCalledWith(CREATIVE_STUDIO_BUCKET);
    expect(bucketClient.remove).toHaveBeenCalledWith(["O1/L1/A1/v1/listing-video.mp4"]);
  });

  it("surfaces a remove error", async () => {
    const { client } = fakeClient({ removeError: { message: "denied" } });
    const port = new SupabaseVideoStoragePort(client as never);
    await expect(port.remove(CREATIVE_STUDIO_BUCKET, "x.mp4")).rejects.toThrow(/denied/);
  });
});
