# ADR-0009 — Asset Retention & Cleanup Policy

- **Status:** Accepted — 2026-07-23
- **Scope:** F4.5 — retention, archive, garbage collection, and user-requested delete for
  **Source Video** Assets (`kind=video, sourceType=seller_upload`).
- **Related:** ADR-0006 (job routing), ADR-0007 (source replacement policy), ADR-0008
  (temporary media access), F3-A Contract Freeze.
- **Supersedes deferral in:** ADR-0007 §5 (cleanup deferred to F4.5) and §6/§7 (delete out of
  scope) — this ADR is where that retention + delete design lands.

## Context

The Source Video model is **append-only**: every upload/replace creates a new immutable
`kind=video, sourceType=seller_upload` Asset, and F3's `resolveVideoSource` selects the
**newest** one for a `(listingId, ownerId)` (`src/lib/video-engine/worker-deps.ts:473` —
predicate `kind==="video" && sourceType==="seller_upload" && ownerId===ownerId`, sort
`createdAt` desc, `[0]`; **no `lifecycle` filter**). The `AssetStore` port
(`src/lib/assets/types.ts:73`) is insert-only — `insert / findBySource / listByListing /
getById`, no mutation or delete — so replacements accumulate: a listing retains every source it
ever uploaded, only the newest is ever selected (ADR-0007 §5).

This ADR records how those orphans are reclaimed and how a user-requested delete is modeled,
without cleanup ever becoming a second authority on which source is current.

## Single-authority principle (binding)

```text
Cleanup nunca decide cuál Source Video está vigente.

La única autoridad para determinar el Source vigente es resolveVideoSource.

Cleanup únicamente consume esa decisión para identificar Assets que jamás volverán a ser seleccionados.

Nunca reimplementa.
Nunca duplica reglas.
Nunca calcula por su cuenta.
```

## Decision

### 1. Retention policy

- Always retain the **current** Source (as decided by `resolveVideoSource`) plus the **K**
  most-recent previous Sources.
- **`K = 3`** initially, held as an easily-parameterizable server-side constant (single source
  of truth, no per-call override, no client influence).
- Everything else — Sources older than `current + K` — is eligible for archive.
- Rationale for the `+ K` buffer: append-only + newest-wins means any Source older than current
  will **never be selected again** (an immutable Asset can never become newest again), so the
  buffer is purely a rollback/safety margin, not a correctness requirement.

### 2. Archive (Soft Delete)

- Archive = transition an eligible orphan's `lifecycle` to `archived` (the value already exists
  in `ASSET_LIFECYCLES`, `src/lib/assets/types.ts:19`). Reversible, non-destructive.
- **Fail-safe:** the current Source is NEVER archived. Before archiving any Asset, cleanup
  reconfirms it is not the value returned by `resolveVideoSource`. There is never a window with
  no valid source (same guarantee as ADR-0007 §3).
- Archiving a **non-current** orphan is inert to routing today: `resolveVideoSource` was already
  not selecting it (it was older than newest). Therefore **orphan cleanup does not require any
  change to `resolveVideoSource`.**

### 3. Garbage Collection (Hard Delete) — later, separate

- Physical deletion (Asset row + Storage object) is **exclusively** a later GC pass over Assets
  that are **already `archived`** and past a grace window. GC never touches a non-`archived`
  Asset.
- GC-by-age needs to know *when* an Asset was archived → an `archived_at` column (migration,
  authored-not-applied, sign-off gated). GC is a distinct sub-stage from archive; archive → GC
  is a strict one-way, time-separated progression.

### 4. User-requested delete ("Eliminar mi video")

- Semantics: **archive the ENTIRE Source Video set for the listing**, so that
  `resolveVideoSource` returns `null` and routing falls back automatically to `photo_slideshow`.
- This is the one place F4.5 forces a change to a frozen contract: for a fully-archived set to
  return `null`, **`resolveVideoSource` must exclude `archived`** — a behavior-preserving change
  (identical selection when no `archived` rows exist), sign-off gated, in a later sub-stage. It
  is NOT modified in the first stage.
- Documented here only; not implemented in the first stage.

### 5. Execution — batch Cron

- Cleanup runs as a **batch on a Vercel Cron target**, authenticated with `CRON_SECRET`
  (timing-safe), mirroring the video-render worker's pattern.
- Cleanup **never** runs during `replace` (ADR-0007's replace path stays untouched — no cleanup
  coupling, no added latency, no new failure mode on the seller's critical path).
- Idempotent: archiving an already-`archived` Asset is a no-op; a re-run produces no new effects.

### 6. Cleanup as a consumer of the current-source decision (architecture)

Cleanup is a **consumer** of `resolveVideoSource`, never a re-implementation of it. Per the
approved separation of responsibilities:

- **`resolveVideoSource`** decides which Asset is current. Sole authority. Unchanged.
- **Cleanup**, per `(listingId, ownerId)`:
  1. calls `resolveVideoSource(listingId, ownerId)` to obtain the current Asset;
  2. calls `listByListing(listingId)` to obtain all Assets;
  3. removes the current Asset from that set;
  4. applies the retention policy (keep the K most-recent, archive the rest) over the remainder.

Cleanup MUST NOT contain a second implementation of the current-source selection algorithm.

**Shared surface = the eligibility predicate ONLY.** Both `resolveVideoSource` and cleanup filter
"is this a seller Source Video?" via a single shared predicate, e.g.
`isSellerSourceVideo(asset)` (`asset.kind === "video" && asset.sourceType === "seller_upload"`).
Owner scoping stays a parameter each applies. Deliberately **no** shared
`listSourceVideoCandidates(...)`-style ordered-candidates helper: ordering/selection of the
*current* Source stays wholly inside `resolveVideoSource`; the only thing shared is eligibility.
Ordering the *non-current remainder* to keep K is a retention concern owned by cleanup and does
not decide which source is current.

## Contract impact (nothing changed in this stage)

| Capability | Frozen contract touched | Requires desfreeze / migration? |
|---|---|---|
| Dry-run (identify orphans) | none — read-only `listByListing` + `resolveVideoSource` | No — safe today. |
| Shared eligibility predicate `isSellerSourceVideo` | `resolveVideoSource`'s module (to consume it instead of an inline predicate) | Yes — behavior-preserving refactor, sign-off gated. Avoids predicate drift. |
| Archive (soft delete) | `AssetStore` has no mutation → add an archive method | Yes — bounded `AssetStore` desfreeze. `archived` value + `lifecycle` column already exist ⇒ likely no new migration for archive itself. |
| User delete → `photo_slideshow` | `resolveVideoSource` must exclude `archived` | Yes — behavior-preserving `resolveVideoSource` desfreeze. |
| GC (hard delete) | `AssetStore` needs delete; Storage delete; GC-by-age needs `archived_at` | Yes — desfreeze + migration (`archived_at`). Later sub-stage. |

Each desfreeze and each migration is authored-not-applied and gated by explicit owner sign-off in
its own sub-stage. None is performed in the first stage.

## Consequences

- Orphan cleanup is correct and safe with **zero** `resolveVideoSource` change, because it only
  archives Assets that were already never selected.
- The single-authority principle is preserved structurally: cleanup consults `resolveVideoSource`
  and shares only the eligibility predicate; it never re-derives the current source.
- User-delete and GC each introduce one clearly-scoped frozen-contract change, sequenced behind
  sign-off, never bundled with orphan cleanup.
- Storage growth remains bounded only by replace frequency until archive + GC are active; the
  read-only dry-run quantifies that magnitude before K or cadence are finalized.
