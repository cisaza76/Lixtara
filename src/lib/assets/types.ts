// Core types for the Asset Manager — the durable home for every photo/video/render
// the Creative Studio produces. Assets are immutable + versioned: nothing is ever
// overwritten; a "new version" is a new row linked to its predecessor via
// `parentAsset`. camelCase mirror of `public.assets`
// (supabase/migrations/20260715171914_creative_studio_video.sql — migration authored,
// NOT applied). This module is storage + identity + lineage only: no cost/plan/policy
// GATING logic lives here (the `cost`/`qa`/`policy` fields carry verdicts computed
// elsewhere; this module never reads or branches on them).
//
// See docs/superpowers/specs/2026-07-15-asset-manager-design.md for the full design.

export const ASSET_KINDS = [
  "photo", "video", "render", "staging", "tour", "thumbnail",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

// Independent of any render/creative job's technical state, and independent of
// distribution ("published" is NOT an Asset state — see the design spec §3).
export const ASSET_LIFECYCLES = [
  "draft", "ready_for_review", "approved", "rejected", "archived",
] as const;
export type AssetLifecycle = (typeof ASSET_LIFECYCLES)[number];

// Full lineage of how an Asset was produced — reconstructable months later.
export interface AssetProvenance {
  sourceAssetIds: string[]; // inputs (e.g. the photo Assets a video was built from)
  capability: string; // "video" | "image" | "tour" | ... (loose here to avoid a
                       // hard dependency on @/lib/media-intelligence's capability enum)
  engine: string; // "video-engine" | "image-engine" | ... — never a raw provider
                   // name in product surfaces
  provider: string; // internal: "remotion" | "veo" | "luma" | "seller_upload" | ...
  prompt: string | null; // exact prompt/params used; null for deterministic/no-prompt
}

export interface Asset {
  id: string;
  listingId: string;
  ownerId: string;
  kind: AssetKind;
  version: number;
  parentAsset: string | null; // predecessor Asset id; null = original/root
  sourceType: string; // "property_photo" | "generated" | ...
  sourceId: string | null; // wrapped source id (nullable for pure-generated Assets)
  provenance: AssetProvenance;
  storageBucket: string; // write-once, together with storagePath
  storagePath: string; // write-once; unique per (storageBucket, storagePath)
  checksum: string | null; // sha256 of the actual byte stream, or null. Only ever set
                            // by a caller that hashed the real bytes (e.g. an upload
                            // path); the Asset Manager never synthesizes one from
                            // metadata. Defaults to null. Never treat this as a content
                            // integrity guarantee unless you know the caller set it
                            // from the real bytes.
  bytes: number;
  mime: string;
  costUsd: number;
  costProvider: string | null;
  createdBy: string;
  lifecycle: AssetLifecycle;
  qa: unknown | null; // Media QA Agent verdict for this version; opaque here
  policy: unknown | null; // Media Policy Engine verdict for this version; opaque here
  createdAt: string; // ISO timestamp, stamped by the store on insert
}

// Everything the store needs to insert a row, minus what the store itself assigns
// (id, createdAt). `parentAsset`, `checksum`, `qa`, `policy` default to null when
// omitted by the caller.
export type NewAsset = Omit<Asset, "id" | "createdAt">;

// The persistence port. Deliberately minimal and deliberately missing any
// update/replace-bytes method: immutability is structural, not a convention callers
// have to remember. A "new version" is always a new `insert`, never a mutation of an
// existing row.
export interface AssetStore {
  insert(asset: NewAsset): Promise<Asset>;
  findBySource(sourceType: string, sourceId: string): Promise<Asset | null>;
  listByListing(listingId: string): Promise<Asset[]>;
  getById(id: string): Promise<Asset | null>;
}
