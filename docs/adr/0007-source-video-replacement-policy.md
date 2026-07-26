# ADR-0007 — Source Video Replacement Policy

- **Status:** Accepted — 2026-07-23
- **Scope:** F4.1 (source upload) + F4.3 (management UI) source-video lifecycle.
- **Related:** F3-A Contract Freeze (Asset immutability); ADR-0006 (job routing); F4.3 plan.

## Context

A seller can upload a Source Video (F4.1) and, from the F4.3 UI, replace it. The Asset model
is **append-only** (the `AssetStore` port is insert-only — no `update`/`delete` by design;
immutability is structural, see the Contract Freeze), and F3's `resolveVideoSource` — frozen —
selects the **newest** `seller_upload` video for the listing/owner. This ADR records the
replacement policy those two frozen facts produce, and why delete/cleanup are deferred.

## Decision

1. **Append-only.** Every upload creates a NEW immutable `kind=video, source_type=seller_upload`
   Asset. Nothing is ever mutated in place. A replacement is just another insert.
2. **Latest upload wins.** `resolveVideoSource` returns the newest such Asset (by `created_at`).
   So a completed replacement is automatically the one the pipeline uses — no pointer to flip,
   no mutation, no change to any frozen contract.
3. **Fail-safe replacement.** The UI keeps the current source visible and selectable until the
   new upload reaches `registered` (the `/complete` step created the durable Asset). If the new
   `initiate`, direct upload, or `/complete` fails — or the user cancels — the previous Asset
   remains the newest valid source. **There is never a window with no valid source.**
4. **Previous Asset retained.** The prior source Asset row AND its Storage object are NOT touched
   on replacement. They simply stop being "newest". This is deliberate: retention is safe, and
   removing them would require a mutation/deletion the frozen contracts don't provide.
5. **Cleanup deferred.** Because prior sources are retained, replacements accumulate orphaned
   Asset rows + Storage objects (a listing keeps every source it ever uploaded, only the newest
   selected). Reclaiming them (by age / non-newest status) is **F4.5 (operation/cleanup)**, not
   F4.3. Until then, storage growth is bounded only by how often a seller replaces.
6. **Delete is out of scope.** A true "remove my source video so the listing falls back to
   photos" needs the routing to STOP selecting a source — which, given `resolveVideoSource` is
   frozen (newest wins, no lifecycle filter) and `AssetStore` is insert-only, requires changing
   frozen F3 contracts (e.g. `AssetStore.archive` + `resolveVideoSource` filtering `archived`).
   That is a separate, explicitly-authorized subproject with its own retention/lifecycle policy.
7. **No physical deletion.** F4.3 never deletes a Storage object or an Asset row. (The physical
   removal of orphaned objects, if adopted, is part of the F4.5 cleanup design + its retention
   policy — not an F4.3 behavior.)

## Consequences

- Replacement is correct and safe TODAY with zero frozen-contract changes.
- The cost is retained orphans until F4.5 defines cleanup + retention.
- When delete is designed, ADR-0006's "single selection mechanism" convergence and this ADR's
  §6/§7 will need a coordinated retention + lifecycle decision (soft-delete via `archived` is the
  current front-runner, but unfrozen only with sign-off).
