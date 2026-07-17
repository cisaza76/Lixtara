# Asset Manager — design spec (the core all media flows through)

**Status:** Design under review
**Date:** 2026-07-15
**Author:** Camilo Isaza + Claude
**Part of:** the Lixtara Creative Studio architecture
(`2026-07-14-lixtara-creative-studio-architecture.md`). This is the detailed design of the
**Asset Manager** component named there.
**Ordering:** decision #3 of the pre-P2 architectural closures. Must exist (at least its core
model + write/read path) **before** the Video Engine, so Remotion receives *selected Assets*,
never raw files.

---

## 1. Why the Asset Manager comes before the Video Engine

Every engine must operate on **Assets**, not files. The flow is:

```
Listing → Asset Manager → selected Assets → Creative Engine → Video/Image/Tour Engine → new Assets
```

If engines read `property_photos` rows or bucket URLs directly, versioning, provenance,
rollback, cost accounting, QA, and approval each become bespoke per engine and drift. Making
the Asset the single unit of media — with identity, lineage, and immutability — is what makes
those cross-cutting concerns trivial and uniform. So the Asset Manager is built first.

## 2. Core principle: immutable, versioned Assets

- **Nothing is ever overwritten.** Every change produces a **new version / new Asset**
  (`LivingRoom v1 → v2 → v3`), linked to its predecessor via `parentAsset`.
- An Asset is a content-addressed, append-only record. Edits, regenerations, staging,
  enhancement, and renders all *create* Assets; they never mutate one.
- This makes rollback (point at an earlier version), comparison (diff two versions), cache
  (identical inputs → reuse), regeneration (re-run from the same source), legal compliance
  (immutable audit trail), reproducibility, and debugging **fall out of the model** instead of
  being engineered per feature.

## 3. The Asset record

Preserve the semantic separation; exact column/type choices are an implementation detail.

```ts
type Asset = {
  id: string;                    // stable unique id
  listingId: string;            // which property this belongs to
  kind: MediaKind;              // "photo" | "video" | "render" | "staging" | "tour" | "thumbnail" | ...
  version: number;              // 1,2,3… within a logical asset lineage
  parentAsset: string | null;   // predecessor Asset id (null = original upload); forms the lineage chain

  // where it came from
  source: AssetSource;          // "seller_upload" | "generated" | "edited" | "imported"
  provenance: {                 // full lineage of how it was produced
    sourceAssetIds: string[];   // inputs (e.g. the real photos a video was built from)
    capability: MediaCapability;// "video" | "image" | "tour" | …
    engine: string;             // "video-engine" | "image-engine" | …  (never a raw provider name in product surfaces)
    provider: string;           // internal: "remotion" | "veo" | "luma" | …
    prompt: string | null;      // the exact prompt/params used (null for deterministic renders with no prompt)
  };

  // the bytes
  storage: { bucketOrStore: string; path: string; bytes: number; mime: string };

  // economics + audit
  cost: { amountUsd: number; provider: string };   // what this Asset cost to produce (0 for uploads / deterministic)
  createdBy: string;            // user id (seller/broker/system)
  createdAt: string;            // ISO timestamp (stamped by the writer, not inside pure code)

  // the QA / policy / approval verdicts attached to THIS version
  qa: QaVerdict | null;         // fidelity check result (Media QA Agent); null until QA runs
  policy: PolicyVerdict | null; // compliance check result (Media Policy Engine); null until it runs
  lifecycle: AssetLifecycle;    // "draft" | "ready_for_review" | "approved" | "rejected" | "archived"
};
```

> **Asset Lifecycle is its own state machine**, distinct from the technical render job and from
> distribution (owner decision 2026-07-15): `draft → ready_for_review → approved | rejected →
> archived`. "published" is NOT an Asset state — it belongs to the Distribution machine (see the
> Creative Jobs observability spec). One asset can render fine, pass QA, wait days for approval,
> be rejected, spawn a new version, and be published to several destinations — three domains, so
> three state machines, never one.

### 3.1 Field rationale (owner's list, mapped)
- **Version + ParentAsset** → immutability + lineage; enables rollback/compare.
- **Source + Provenance (sourceAssetIds, capability, engine, provider, prompt)** → reconstruct
  *any* generated content months later: which photos, which engine/provider, which prompt.
- **Cost + Provider** → per-Asset economics feed the Cost Engine's learning and reporting.
- **CreatedBy / CreatedAt** → audit + support.
- **QA / Policy / Approval** → the trust spine (Media QA Agent → Policy Engine → Approval
  Workflow) attaches verdicts to the specific version they judged, not to a mutable blob.

## 4. Responsibilities (what the Asset Manager does / does not do)

**Does:**
- Create Assets (immutably), assign version + link `parentAsset`.
- Resolve a listing's Assets, and **select** the subset an engine should consume (e.g. hero
  shots for a video) — engines ask the Asset Manager for Assets, never for files.
- Store/retrieve bytes via the storage layer (existing Supabase buckets and/or Vercel Blob per
  the render ADR); return signed/private URLs.
- Record and expose the version lineage (list versions, get parent chain, roll back a listing's
  active Asset to an earlier version).
- Attach QA / Policy / Approval verdicts to a version (write-once per verdict).

**Does not:**
- Decide *what* to generate (Media Intelligence), *whether it's worth it* (Cost Engine), or
  *which provider* (the engines). It is storage + identity + lineage, not policy.
- Mutate bytes. Ever.

## 5. Interface sketch

```ts
interface AssetManager {
  createAsset(input: NewAsset): Promise<Asset>;                 // always a new version; never overwrites
  getAsset(id: string): Promise<Asset | null>;
  listAssets(listingId: string, filter?: AssetFilter): Promise<Asset[]>;
  getLineage(id: string): Promise<Asset[]>;                     // parent chain, oldest→newest
  selectForCapability(listingId: string, capability: MediaCapability): Promise<Asset[]>; // engines call this
  attachVerdict(id: string, verdict: { qa?: QaVerdict; policy?: PolicyVerdict }): Promise<Asset>;
  setApproval(id: string, state: ApprovalState, by: string): Promise<Asset>;
  rollback(listingId: string, toAssetId: string): Promise<Asset>; // makes an earlier version active (creates a pointer, not a copy)
}
```

Engines depend only on `selectForCapability` (input) and `createAsset` (output). They never see
storage paths or provider details of the source.

## 6. Persistence

- One `assets` table (immutable rows; new version = new row). RLS: `listingId` owner-gated,
  same pattern as the rest of the schema.
- **Storage — Supabase Storage is the single source of truth** (owner decision 2026-07-15) for
  BOTH source assets and generated renders. No Vercel Blob in P2 — one permission model, one
  retention policy, one SDK, one URL scheme, one delete strategy, one audit surface. (Vercel
  Blob may be revisited later only if it shows a measurable egress/CDN/latency/cost advantage.)
- The render target (Vercel Sandbox) may use its own temp disk *during* the render, but the
  final MP4 is uploaded to Supabase Storage and its Asset row created **before the job is
  considered complete**; the temp file is then deleted.
- **No schema change is made autonomously** — this spec's migration is authored and applied by
  the owner (per CLAUDE.md), and will be **idempotent** (the standard we just set).

## 7. Relationship to the existing code

- `media_agent_jobs.payload` already carries per-run analysis; the Asset Manager is the durable
  home for the *media itself* (uploads + generated outputs), which the payload only references.
- `property_photos` (seller uploads) become the **v1 Assets** of `kind: "photo"` via **lazy,
  idempotent wrapping at first use** (owner decision 2026-07-15) — NOT a mass backfill in P2.
  When the Studio needs a photo: look up an existing Asset that wraps it; if none, create the
  wrapper Asset (keeping the original file, recording provenance) and continue. A **unique
  constraint on `(source_type, source_id)`** (e.g. `("property_photo", <photo id>)`) guarantees
  exactly one wrapper per source and makes the wrap idempotent under concurrency. A progressive
  backfill can run later once the Asset model proves stable. (Design the wrapper so uploads keep
  working unchanged.)

## 8. Scope for the first slice (with P2)

Ship the **thin** Asset Manager P2 needs, not the whole thing:
- `createAsset` (immutable) + `getAsset` + `listAssets` + `selectForCapability` for photos.
- Store the Video Engine's render output as a `kind: "video"` Asset with full provenance
  (source photo Assets, engine, provider `remotion`, cost) and `approval: "generated"`.
- Version lineage + rollback and the full QA/Policy attachment can deepen alongside P3 (when
  generative outputs make them load-bearing).

## 9. Resolved decisions (owner, 2026-07-15)
1. **Store choice — Supabase Storage, single source of truth** for both source assets and
   renders in P2. No Vercel Blob yet. (§6)
2. **Backfill — lazy, idempotent wrapping at first use**, guarded by a unique
   `(source_type, source_id)` constraint; no mass backfill in P2. (§7)
3. **Content addressing — deferred.** Hash-based dedupe of identical bytes is a later
   optimization; not built until cache pressure is real.
