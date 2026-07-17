// Pure, server-side idempotency key builder for Creative Studio video generation
// (Gate C1 — the enqueue route). NEVER derived from client-supplied identity/state
// fields: every input here is controlled/derived by the enqueue route itself — an
// ownership-checked `listingId`, the pinned `TEMPLATE_VERSION` (src/lib/video-engine/
// versions.ts), the listing's resolved source photo ids, and a caller-computed
// fingerprint of the render's input. Two requests that would produce the same
// deliverable collapse onto the same key, so `createJob`'s idempotency
// (src/lib/creative-jobs/jobs.ts — findActiveByIdempotencyKey / the 23505 catch)
// naturally returns the existing job instead of enqueuing a duplicate.
import { createHash } from "node:crypto";

export interface BuildIdempotencyKeyInput {
  listingId: string;
  capability: string;
  templateVersion: string;
  // Order-independent: normalized (sorted) before hashing, so callers never have to
  // worry about array order producing a spurious different key for the same
  // underlying set of source photos.
  sourceAssetIds: string[];
  // A caller-computed fingerprint of any additional render input. In P2's first slice
  // there are no per-request options (one template, one aspect ratio, no captions/user
  // params), so callers typically derive this from the source set itself
  // (see `hashSourceAssetIds` below) — kept as its own field so a future per-request
  // option can be folded in without changing this function's signature.
  inputHash: string;
}

function normalizeIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

// Deterministic: identical inputs (including source-asset SET, regardless of the
// order they were passed in) always produce the same key; changing any input —
// listingId, capability, templateVersion, the source-asset set, or inputHash —
// produces a different key.
export function buildIdempotencyKey(input: BuildIdempotencyKeyInput): string {
  const payload = JSON.stringify({
    listingId: input.listingId,
    capability: input.capability,
    templateVersion: input.templateVersion,
    sourceAssetIds: normalizeIds(input.sourceAssetIds),
    inputHash: input.inputHash,
  });
  return createHash("sha256").update(payload).digest("hex");
}

// Convenience fingerprint of a source-asset id set, for callers that have no richer
// "input" to hash yet — order-independent for the same reason as buildIdempotencyKey.
export function hashSourceAssetIds(sourceAssetIds: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(normalizeIds(sourceAssetIds))).digest("hex");
}
