# ADR-0001 — One generic Property Video Pipeline with pluggable source strategies

- **Status:** Accepted (design) — 2026-07-22
- **Context doc:** `docs/superpowers/plans/2026-07-22-f2a-video-tour-upload-architecture.md`

## Context

Creative Studio produces a branded Lixtara listing video. Today one source exists (a photo
slideshow); more are coming (owner-uploaded clip, drone footage, AI-generated), and the same footage
will need multiple output shapes (16:9, vertical/reel, square, MLS, language cuts). We must decide
whether each of those becomes its own specialized composition + pipeline path, or whether there is
one generic pipeline parameterized along stable axes.

## Decision

**One generic composition (`ListingVideoComposition`) and one pipeline, parameterized by TWO
orthogonal axes:**

- **Source Strategy** — *where the body content comes from* (`photo_slideshow`, `uploaded_video`,
  `drone_video`, `future_ai`, …).
- **Render Profile** — *what output objective/format/styling the render targets* (`standard`,
  `luxury`, `social_vertical`/`reel`, `square`, `mls`, …).

Both live on the job and in the output's provenance. The composition renders a shared Lixtara frame
(OpeningCard → **body(sourceStrategy)** → ClosingCard + shared lower-third, watermark, gold motif,
system fonts); the **body** differs by Source Strategy, and the **output dimensions/format/styling**
come from the Render Profile (via Remotion `calculateMetadata`). Adding a source is an additive
change at two seams (source selector + body renderer); adding a profile is one registry entry — never
a new pipeline or composition. A listing may hold many video Assets; exactly one is the **Primary
Marketing Video**.

## Rationale

- **Brand defined once.** The frame (typography, cards, lower-third, watermark, motion motif) is
  authored a single time; a brand change updates every strategy. N specialized compositions would
  duplicate and inevitably drift the brand.
- **One thing to secure, test, monitor, version.** The font guard, sandbox, QA, storage + read-verify,
  Asset model, worker, idempotency, and error taxonomy — all shared. N pipelines = N× the hardening
  and N× the surfaces that can regress.
- **Open/closed.** Open for new sources (register a selector + a body), closed for the shared frame.
  This matches how F1 already isolated variables (fonts, images) behind stable seams.
- **Cheap generalization.** The change is one `strategy` column + generalizing `selectForCapability`
  → `selectSourceForStrategy` + a discriminated-union `inputProps`. No re-bake, no new tables.

## Consequences

- `capability` stays `'video'`; the discriminators are `source_strategy` + `render_profile`.
  Provenance records both — "which source × which profile produced this video?".
- A listing holds many video Assets with exactly one `is_primary` (Primary Marketing Video),
  enforced by a partial unique index — no schema change to add a vertical cut, a short reel, or a
  language variant later.
- The existing `ListingVideo` is retrofitted (moved, not rewritten) into the `photo_slideshow` body
  at the `standard` profile — a behavior-preserving refactor validated the same way F1 was.
- The generic composition must handle heterogeneous bodies + multiple output dimensions (a
  switch/indirection + `calculateMetadata`), and keep the `inputProps` union coherent — an accepted,
  small cost. The stable interface between the axes is **frozen before the first feature** (F2-A §10).

## Alternatives rejected

- **One specialized composition + pipeline per source (or per profile).** Rejected: brand
  duplication/drift, N× the hardening/testing/monitoring, and every new source/format becomes a
  from-scratch pipeline rather than an additive strategy/profile.
- **A single `strategy` axis conflating source and output.** Rejected: `uploaded_video → reel` and
  `photo_slideshow → luxury` prove source and output vary independently; collapsing them would force
  a combinatorial explosion of strategy values or, worse, specialized compositions later.

## Future Evolution

This architecture is deliberately designed so that Creative Studio can grow for years **without new
compositions or new pipelines** — only additive registrations at the frozen seams:

- **Multiple Source Strategies.** New footage origins (`drone_video`, `future_ai`, `matterport`,
  `agent_selfie_tour`, …) each add just a *source selector* (Seam A) + a *body renderer* (Seam B).
  The brand frame, worker, sandbox, font guard, QA, storage, Asset model, and error taxonomy are
  untouched.
- **Multiple Render Profiles.** New output objectives (`social_vertical`/`reel` 9:16, `square` 1:1,
  `luxury` styling, `mls` compliance, language-specific cuts) each add just a *profile registry
  entry* (Seam C: dimensions/fps/safe-areas/style tokens/expected-QA-spec). One composition emits
  every aspect ratio via `calculateMetadata`; there is never a "vertical composition".
- **Multiple outputs per listing.** A single source can fan out into many Assets — e.g. the same
  uploaded clip rendered as `standard` + `social_vertical` + a Spanish cut — all reusing the pipeline,
  with exactly one flagged Primary Marketing Video and the rest available for syndication/social.
- **Orthogonality is the invariant.** Because Source Strategy, Render Profile, and "primary vs
  secondary" are independent, their combinations grow multiplicatively while the code grows
  additively. Any capability on the F1-R Phase-2 roadmap (Reels, vertical tours, social exports,
  premium templates, multi-language, advanced branding) maps onto *a new source, a new profile, or a
  new output* — not a new pipeline.

The one thing that must be gotten right up front is the **frozen internal contract** between the
three seams (F2-A §10 step 3); everything above is cheap only if that interface is clean.
