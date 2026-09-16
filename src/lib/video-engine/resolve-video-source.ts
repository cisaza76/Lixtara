// Canonical home for resolving the CURRENT Source Video of a listing.
//
// This function is the SINGLE AUTHORITY for "which Source Video is vigente" per ADR-0009
// (docs/adr/0009-asset-retention-and-cleanup.md). Any consumer that needs the current source —
// the render worker (worker-deps.ts) and the retention dry-run — imports it from here. Nothing
// reimplements, duplicates, or recomputes this selection rule. Extracted verbatim from
// worker-deps.ts (behavior-preserving; same name, signature, algorithm, filters, ordering,
// and Asset | null return) — the logic is unchanged.
import type { Asset, AssetStore } from "@/lib/assets/types";

// Default uploaded_video source resolver: the newest NON-ARCHIVED kind=video /
// source_type=seller_upload Asset for the listing+owner.
//
// Issue #118 (2026-08-11) — `lifecycle` is part of the selection rule, not decoration.
// An archived Asset is one whose bytes are gone or scheduled to go: retention (F4.6)
// archives superseded sources, and seller removal archives the current one. Before this
// filter the resolver ignored `lifecycle` entirely, so an archived Asset stayed eligible —
// the render worker could select a source whose Storage object had already been deleted,
// and the seller-facing API could report a removed video as still present. Archived is
// terminal: nothing un-archives, so an excluded Asset can never resolve again.
export function defaultResolveVideoSource(
  assets: AssetStore,
): (listingId: string, ownerId: string) => Promise<Asset | null> {
  return async (listingId, ownerId) => {
    const all = await assets.listByListing(listingId);
    const uploads = all.filter(
      (a) =>
        a.kind === "video" &&
        a.sourceType === "seller_upload" &&
        a.ownerId === ownerId &&
        a.lifecycle !== "archived",
    );
    if (uploads.length === 0) return null;
    return [...uploads].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  };
}
