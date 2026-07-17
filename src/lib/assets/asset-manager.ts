// The Asset Manager: storage + identity + lineage for every photo/video/render the
// Creative Studio produces. Persistence is injected via the `AssetStore` port so this
// stays a pure application layer, unit-testable with an in-memory fake — no DB in
// tests. Nothing here decides *what* to generate (Media Intelligence), *whether it's
// worth it* (Cost Engine), or *which provider* (the engines); it never reads/branches
// on `qa`/`policy`/`cost` beyond carrying them through.
import type { Asset, AssetKind, AssetLifecycle, AssetProvenance, AssetStore, NewAsset } from "@/lib/assets/types";

export type CreateAssetInput = Omit<
  NewAsset,
  "checksum" | "parentAsset" | "qa" | "policy"
> & {
  checksum?: string | null;
  parentAsset?: string | null;
  qa?: unknown | null;
  policy?: unknown | null;
};

// Always inserts a new, immutable row — this is the only write path in the module.
// A "new version" is just this function called again with `version` incremented and
// `parentAsset` pointing at the predecessor; the predecessor row is never touched
// (the AssetStore port has no method that could touch it).
//
// `checksum` is caller-provided and passed through as-is (a sha256 of the actual byte
// stream — e.g. from an upload path or the render pipeline, which has the real bytes).
// The Asset Manager itself never touches raw bytes here (it operates on already-
// uploaded storage references, not buffers), so when the caller doesn't supply one we
// store `null` rather than synthesizing a hash from storage-identity metadata — a
// metadata hash would look like content integrity without being one.
export async function createAsset(store: AssetStore, input: CreateAssetInput): Promise<Asset> {
  const newAsset: NewAsset = {
    ...input,
    parentAsset: input.parentAsset ?? null,
    checksum: input.checksum ?? null,
    qa: input.qa ?? null,
    policy: input.policy ?? null,
  };
  return store.insert(newAsset);
}

export interface PropertyPhotoRef {
  id: string;
  url: string;
  bucket: string;
  path: string;
}

// Lazy, idempotent wrapping of a seller-uploaded `property_photos` row into a v1
// `kind:"photo"` Asset, per the design spec §7/§9.2: uploads keep working unchanged,
// and the first thing that needs the photo as an Asset creates the wrapper. Guarded by
// the store's unique (source_type, source_id) rule, so concurrent wraps of the same
// photo converge on one row.
export async function wrapPropertyPhoto(
  store: AssetStore,
  { photo, listingId, ownerId }: { photo: PropertyPhotoRef; listingId: string; ownerId: string },
): Promise<Asset> {
  const existing = await store.findBySource("property_photo", photo.id);
  if (existing) return existing;

  const provenance: AssetProvenance = {
    sourceAssetIds: [],
    capability: "photo",
    engine: "asset-manager",
    provider: "seller_upload",
    prompt: null,
  };

  return createAsset(store, {
    listingId,
    ownerId,
    kind: "photo",
    version: 1,
    parentAsset: null,
    sourceType: "property_photo",
    sourceId: photo.id,
    provenance,
    storageBucket: photo.bucket,
    storagePath: photo.path,
    bytes: 0,
    mime: "",
    costUsd: 0,
    costProvider: null,
    createdBy: ownerId,
    lifecycle: "approved" as AssetLifecycle,
  });
}

const PHOTO_KIND: AssetKind = "photo";

// Ordered, stable list of the listing's photo Assets — what an engine consumes as its
// "selected Assets" input. Engines call this (and `createAsset` for their output);
// they never read `property_photos` or bucket URLs directly.
export async function selectForCapability(
  store: AssetStore,
  listingId: string,
  // Reserved for future capability-specific selection (e.g. tour vs video framing);
  // the first slice (design spec §8) always returns the listing's photo Assets.
  _capability: string,
): Promise<Asset[]> {
  const assets = await store.listByListing(listingId);
  return assets
    .filter((a) => a.kind === PHOTO_KIND)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
