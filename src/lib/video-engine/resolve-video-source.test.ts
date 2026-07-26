import { describe, it, expect } from "vitest";
import { defaultResolveVideoSource } from "./resolve-video-source";
import type { Asset, AssetStore, NewAsset } from "@/lib/assets/types";

const OWNER = "11111111-1111-1111-1111-111111111111";
const LISTING = "22222222-2222-2222-2222-222222222222";

function asset(o: Partial<Asset> = {}): Asset {
  return {
    id: "a", listingId: LISTING, ownerId: OWNER, kind: "video", version: 1, parentAsset: null,
    sourceType: "seller_upload", sourceId: "up",
    provenance: { sourceAssetIds: [], capability: "video", engine: "asset-manager", provider: "seller_upload", prompt: null },
    storageBucket: "creative-studio", storagePath: "source/x", checksum: null, bytes: 1000,
    mime: "video/mp4", costUsd: 0, costProvider: null, createdBy: OWNER, lifecycle: "draft", qa: null, policy: null,
    createdAt: "2026-07-01T00:00:00.000Z", ...o,
  };
}

// Minimal read-only AssetStore fake: only listByListing is exercised by the resolver.
function store(rows: Asset[]): AssetStore {
  return {
    listByListing: async (listingId) => rows.filter((a) => a.listingId === listingId),
    insert: async (): Promise<Asset> => { throw new Error("not used"); },
    findBySource: async () => null,
    getById: async () => null,
  } satisfies AssetStore & { insert(a: NewAsset): Promise<Asset> };
}

describe("defaultResolveVideoSource (canonical current-source authority — behavior parity)", () => {
  it("empty list → null", async () => {
    const resolve = defaultResolveVideoSource(store([]));
    expect(await resolve(LISTING, OWNER)).toBeNull();
  });

  it("ignores assets whose kind !== 'video'", async () => {
    const resolve = defaultResolveVideoSource(
      store([asset({ id: "photo", kind: "photo", sourceType: "property_photo" }), asset({ id: "render", kind: "render", sourceType: "generated" })]),
    );
    expect(await resolve(LISTING, OWNER)).toBeNull();
  });

  it("ignores assets whose sourceType !== 'seller_upload'", async () => {
    const resolve = defaultResolveVideoSource(store([asset({ id: "gen", sourceType: "generated" })]));
    expect(await resolve(LISTING, OWNER)).toBeNull();
  });

  it("ignores assets of a different ownerId", async () => {
    const resolve = defaultResolveVideoSource(store([asset({ id: "other", ownerId: "someone-else" })]));
    expect(await resolve(LISTING, OWNER)).toBeNull();
  });

  it("among eligible candidates, returns the one with the greatest createdAt", async () => {
    const resolve = defaultResolveVideoSource(
      store([
        asset({ id: "old", createdAt: "2026-07-01T00:00:00.000Z" }),
        asset({ id: "new", createdAt: "2026-07-05T00:00:00.000Z" }),
        asset({ id: "mid", createdAt: "2026-07-03T00:00:00.000Z" }),
      ]),
    );
    const r = await resolve(LISTING, OWNER);
    expect(r?.id).toBe("new");
  });

  it("lifecycle plays no role in selection — an archived newest is still chosen (F4.6 Stage B left the authority untouched)", async () => {
    // Pins the ADR-0009 single-authority contract across Stage B: the retention engine reads
    // `lifecycle`, the authority does NOT. Selection remains newest-createdAt over eligible
    // seller uploads, whatever their lifecycle.
    const resolve = defaultResolveVideoSource(
      store([
        asset({ id: "activeOld", createdAt: "2026-07-01T00:00:00.000Z", lifecycle: "approved" }),
        asset({ id: "archivedNew", createdAt: "2026-07-09T00:00:00.000Z", lifecycle: "archived" }),
      ]),
    );
    const r = await resolve(LISTING, OWNER);
    expect(r?.id).toBe("archivedNew");
  });

  it("returns an Asset when a match exists, null otherwise", async () => {
    const resolve = defaultResolveVideoSource(store([asset({ id: "only" })]));
    const r = await resolve(LISTING, OWNER);
    expect(r).not.toBeNull();
    expect(r?.id).toBe("only");
    // and null for a listing with no candidates
    expect(await resolve("no-such-listing", OWNER)).toBeNull();
  });
});
