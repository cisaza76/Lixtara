import { describe, it, expect } from "vitest";
import {
  createAsset,
  wrapPropertyPhoto,
  selectForCapability,
} from "@/lib/assets/asset-manager";
import type { AssetStore, Asset, NewAsset } from "@/lib/assets/types";

// In-memory fake AssetStore. Enforces the same unique (source_type, source_id)
// rule as the real `assets_source_unique` index (supabase/migrations/
// 20260715171914_creative_studio_video.sql), so a bug that bypasses
// wrapPropertyPhoto's idempotency check fails loudly here too.
function fakeStore(): AssetStore & { rows: Asset[] } {
  const rows: Asset[] = [];
  return {
    rows,
    async insert(a: NewAsset) {
      if (a.sourceId != null) {
        const dupe = rows.find(
          (r) => r.sourceType === a.sourceType && r.sourceId === a.sourceId,
        );
        if (dupe) {
          throw new Error(
            `unique violation: (source_type, source_id) = (${a.sourceType}, ${a.sourceId})`,
          );
        }
      }
      const row = { ...a, id: `a${rows.length + 1}`, createdAt: "T" } as Asset;
      rows.push(row);
      return row;
    },
    async findBySource(sourceType, sourceId) {
      return (
        rows.find((r) => r.sourceType === sourceType && r.sourceId === sourceId) ??
        null
      );
    },
    async listByListing(listingId) {
      return rows.filter((r) => r.listingId === listingId);
    },
    async getById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
  };
}

const provenance = {
  sourceAssetIds: [] as string[],
  capability: "photo",
  engine: "asset-manager",
  provider: "seller_upload",
  prompt: null,
};

describe("wrapPropertyPhoto", () => {
  it("creates a v1 photo Asset on first wrap", async () => {
    const store = fakeStore();
    const a = await wrapPropertyPhoto(store, {
      photo: { id: "p1", url: "u", bucket: "b", path: "x" },
      listingId: "L",
      ownerId: "O",
    });
    expect(a.kind).toBe("photo");
    expect(a.version).toBe(1);
    expect(a.sourceType).toBe("property_photo");
    expect(a.sourceId).toBe("p1");
    expect(store.rows).toHaveLength(1);
  });

  it("is idempotent — second wrap returns the same Asset, no new row", async () => {
    const store = fakeStore();
    const first = await wrapPropertyPhoto(store, {
      photo: { id: "p1", url: "u", bucket: "b", path: "x" },
      listingId: "L",
      ownerId: "O",
    });
    const second = await wrapPropertyPhoto(store, {
      photo: { id: "p1", url: "u", bucket: "b", path: "x" },
      listingId: "L",
      ownerId: "O",
    });
    expect(second.id).toBe(first.id);
    expect(store.rows).toHaveLength(1);
  });
});

describe("createAsset", () => {
  it("always inserts a new immutable row (never overwrites)", async () => {
    const store = fakeStore();
    await createAsset(store, {
      listingId: "L",
      ownerId: "O",
      kind: "video",
      version: 1,
      sourceType: "generated",
      sourceId: null,
      provenance: {
        sourceAssetIds: ["a1"],
        capability: "video",
        engine: "video-engine",
        provider: "remotion",
        prompt: null,
      },
      storageBucket: "renders",
      storagePath: "L/v1.mp4",
      bytes: 10,
      mime: "video/mp4",
      costUsd: 0,
      costProvider: "remotion",
      createdBy: "O",
      lifecycle: "ready_for_review",
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].lifecycle).toBe("ready_for_review");
  });

  it("yields checksum: null when the caller doesn't supply one (never synthesizes a metadata hash)", async () => {
    const store = fakeStore();
    const a = await createAsset(store, {
      listingId: "L",
      ownerId: "O",
      kind: "photo",
      version: 1,
      sourceType: "generated",
      sourceId: null,
      provenance,
      storageBucket: "b",
      storagePath: "L/v1.jpg",
      bytes: 100,
      mime: "image/jpeg",
      costUsd: 0,
      costProvider: null,
      createdBy: "O",
      lifecycle: "approved",
    });
    expect(a.checksum).toBeNull();
  });

  it("passes a caller-provided checksum through unchanged", async () => {
    const store = fakeStore();
    const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85";
    const a = await createAsset(store, {
      listingId: "L",
      ownerId: "O",
      kind: "photo",
      version: 1,
      sourceType: "generated",
      sourceId: null,
      provenance,
      storageBucket: "b",
      storagePath: "L/v1.jpg",
      bytes: 100,
      mime: "image/jpeg",
      checksum: sha256,
      costUsd: 0,
      costProvider: null,
      createdBy: "O",
      lifecycle: "approved",
    });
    expect(a.checksum).toBe(sha256);
  });

  it("a new version is a new row with parentAsset set; the original row is never mutated", async () => {
    const store = fakeStore();
    const v1 = await createAsset(store, {
      listingId: "L",
      ownerId: "O",
      kind: "photo",
      version: 1,
      parentAsset: null,
      sourceType: "generated",
      sourceId: null,
      provenance,
      storageBucket: "b",
      storagePath: "L/v1.jpg",
      bytes: 100,
      mime: "image/jpeg",
      costUsd: 0,
      costProvider: null,
      createdBy: "O",
      lifecycle: "approved",
    });
    const v2 = await createAsset(store, {
      listingId: "L",
      ownerId: "O",
      kind: "photo",
      version: 2,
      parentAsset: v1.id,
      sourceType: "generated",
      sourceId: null,
      provenance,
      storageBucket: "b",
      storagePath: "L/v2.jpg",
      bytes: 200,
      mime: "image/jpeg",
      costUsd: 0,
      costProvider: null,
      createdBy: "O",
      lifecycle: "approved",
    });

    expect(store.rows).toHaveLength(2);
    expect(v2.id).not.toBe(v1.id);
    expect(v2.parentAsset).toBe(v1.id);

    // The fake store has no update method — there is structurally no code path
    // that could have mutated v1's bytes. Assert it explicitly anyway.
    const original = store.rows.find((r) => r.id === v1.id)!;
    expect(original.storagePath).toBe("L/v1.jpg");
    expect(original.bytes).toBe(100);
    expect(original.checksum).toBe(v1.checksum);
  });

  it("a version chain v1 -> v2 is retrievable via parentAsset + getById", async () => {
    const store = fakeStore();
    const v1 = await createAsset(store, {
      listingId: "L",
      ownerId: "O",
      kind: "photo",
      version: 1,
      parentAsset: null,
      sourceType: "generated",
      sourceId: null,
      provenance,
      storageBucket: "b",
      storagePath: "L/v1.jpg",
      bytes: 100,
      mime: "image/jpeg",
      costUsd: 0,
      costProvider: null,
      createdBy: "O",
      lifecycle: "approved",
    });
    const v2 = await createAsset(store, {
      listingId: "L",
      ownerId: "O",
      kind: "photo",
      version: 2,
      parentAsset: v1.id,
      sourceType: "generated",
      sourceId: null,
      provenance,
      storageBucket: "b",
      storagePath: "L/v2.jpg",
      bytes: 200,
      mime: "image/jpeg",
      costUsd: 0,
      costProvider: null,
      createdBy: "O",
      lifecycle: "approved",
    });

    const fetchedV2 = await store.getById(v2.id);
    expect(fetchedV2?.parentAsset).toBe(v1.id);
    const fetchedV1 = await store.getById(fetchedV2!.parentAsset!);
    expect(fetchedV1?.id).toBe(v1.id);
    expect(fetchedV1?.version).toBe(1);
  });
});

describe("listByListing", () => {
  it("returns only the given listing's Assets (isolation)", async () => {
    const store = fakeStore();
    await wrapPropertyPhoto(store, {
      photo: { id: "p1", url: "u", bucket: "b", path: "x1" },
      listingId: "L1",
      ownerId: "O",
    });
    await wrapPropertyPhoto(store, {
      photo: { id: "p2", url: "u", bucket: "b", path: "x2" },
      listingId: "L2",
      ownerId: "O",
    });

    const l1Assets = await store.listByListing("L1");
    expect(l1Assets).toHaveLength(1);
    expect(l1Assets[0].listingId).toBe("L1");
    expect(l1Assets[0].sourceId).toBe("p1");
  });
});

describe("selectForCapability", () => {
  it("returns only kind:photo Assets for the listing, in a stable order", async () => {
    const store = fakeStore();
    const p1 = await wrapPropertyPhoto(store, {
      photo: { id: "p1", url: "u", bucket: "b", path: "x1" },
      listingId: "L",
      ownerId: "O",
    });
    const p2 = await wrapPropertyPhoto(store, {
      photo: { id: "p2", url: "u", bucket: "b", path: "x2" },
      listingId: "L",
      ownerId: "O",
    });
    // A non-photo Asset on the same listing must be excluded.
    await createAsset(store, {
      listingId: "L",
      ownerId: "O",
      kind: "video",
      version: 1,
      sourceType: "generated",
      sourceId: null,
      provenance: {
        sourceAssetIds: [p1.id, p2.id],
        capability: "video",
        engine: "video-engine",
        provider: "remotion",
        prompt: null,
      },
      storageBucket: "renders",
      storagePath: "L/v1.mp4",
      bytes: 10,
      mime: "video/mp4",
      costUsd: 0,
      costProvider: "remotion",
      createdBy: "O",
      lifecycle: "ready_for_review",
    });
    // A photo on a different listing must be excluded.
    await wrapPropertyPhoto(store, {
      photo: { id: "p3", url: "u", bucket: "b", path: "x3" },
      listingId: "OTHER",
      ownerId: "O",
    });

    const selected = await selectForCapability(store, "L", "video");
    expect(selected.map((a) => a.id)).toEqual([p1.id, p2.id]);
    expect(selected.every((a) => a.kind === "photo")).toBe(true);
  });
});
