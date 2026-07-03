# Property Video Agent — Media Intelligence Layer (MVP slice)

**Status:** Approved design, pending spec review
**Date:** 2026-07-03
**Author:** Camilo Isaza + Claude
**Scope:** First vertical slice of the "Property Video Agent" program

---

## 1. Context & motivation

Sellers upload imperfect photos from their phones. Today they must manually choose
which shots matter, in what order, and how to present the property. Lixtara already has
the *generation* primitives — a pluggable per-clip video engine (`TourProcessor` + a live
Veo/Gemini "Living Listing" processor), a Luma virtual-staging pipeline, a `tour_jobs`
state table, a private `tour-videos` bucket, rate limiting, webhook idempotency, and
bilingual i18n. **What is missing is the intelligence**: nothing classifies rooms, scores
quality, dedupes, selects the hero shots, or writes a whole-property visual brief.

This slice builds that intelligence layer and an extensible provider skeleton, producing a
real, demoable output (classified + scored shots, a hero sequence, an auto-written brief,
per-shot prompts, and a job that runs through every state) with a **mock render** standing
in for the final MP4. It introduces **no new heavy infra, no external spend, and no
compliance risk**. Real MP4 rendering (Remotion) and a live AI-video provider are explicit
follow-on slices.

### The program, decomposed (for reference)

- **A — Media Intelligence** ← *this slice*
- **B — Composition Engine** (Remotion, deterministic reels from real photos) — next
- **C — `VideoGenerationProvider` + live adapters** — skeleton here, live providers next
- **D — Seller Studio UX** — thin surface here, full studio later
- **E — 3D / immersive tours** — deferred (KIRI removed; `tour_jobs` preserved)

---

## 2. Confirmed decisions (MVP baseline)

1. Single table `video_agent_jobs`; the full analysis lives in a **versioned `jsonb`
   payload**. No schema churn on `property_photos`.
2. v1 = **Media Intelligence layer + mock render**. No real MP4 generation yet.
3. **Deterministic pipeline with LLM at specific nodes**, not an autonomous agent.
4. **Extend** the existing `TourProcessor`, `tour_jobs`, `tour-videos`, and staging
   pipeline — do not reinvent them.
5. Everything gated behind `VIDEO_AGENT_ENABLED`.
6. External providers stay as adapters/stubs: Veo (wraps existing processor), Kling,
   Runway, Luma, Higgsfield, Wan.
7. **Not** in this slice: Remotion, video-file ingestion, 3D tours, overage billing.
8. **Compliance first**: never publish a generated view that could misrepresent the
   property. v1 renders nothing real; all deliverables are mock. When real generation
   lands, it inherits `LIVING_LISTING_PROMPT`-style geometry guardrails + the
   `livingDisclaimer` disclosure precedent.

---

## 3. Architecture

Deterministic pipeline, LLM invoked only at specific nodes. Orchestration is plain,
testable code — reproducible, predictable cost, easy to debug.

### 3.1 New module: `src/lib/media-intelligence/`

| File | Responsibility | Engine |
|---|---|---|
| `types.ts` | `Asset`, `Classification`, `QualityScore`, `VisualBrief`, `SelectedShot`, `GenerationPrompt`, `Deliverable`, `AgentJobStatus`, `BriefPayload` (versioned) | — |
| `ingest.ts` | Load `property_photos` rows for a listing; validate count (≥3) and that URLs are present | deterministic |
| `classify.ts` | Room/type + tags per photo (fachada, sala, cocina, baño, exterior, amenity, lote, aérea, plano, render, otro) | Claude vision (`@ai-sdk/anthropic`, `generateObject` + zod) |
| `quality.ts` | Score sharpness, lighting, framing, near-duplicate grouping; resolution deterministic when dimensions available | Claude vision (v1); seam left for `sharp`/Laplacian CV later |
| `select.ts` | Choose the hero sequence in real-estate storytelling order, one best per room, drop low-quality/dupes, cap N | **pure function** |
| `brief.ts` | Write the visual brief (narrative, mood, target buyer, hook) from selected shots + listing facts | Claude (`generateObject` + zod) |
| `prompts.ts` | Per-shot generation prompts with real-estate guardrails (no fabricated geometry; mirrors `LIVING_LISTING_PROMPT`) | deterministic templates |
| `deliverables.ts` | Catalog of planned outputs (horizontal cinematic, vertical reel, teaser, social variants) — mirrors `STAGING_STYLES` shape | deterministic |
| `agent.ts` | Orchestrator: drives status transitions, persists payload, logs `[video-agent]` | plain code |
| `providers/types.ts` | `VideoGenerationProvider` interface + `selectProvider()` | — |
| `providers/mock.ts` | `MockProvider` — returns a placeholder deliverable, always available | — |
| `providers/veo.ts` | Adapter wrapping the existing `TourProcessor`/Veo engine (registered, not invoked in v1) | — |
| `providers/stubs.ts` | Kling / Runway / Luma / Higgsfield / Wan adapters that throw `ProviderNotConfiguredError` | — |
| `providers/index.ts` | Registry + `selectProvider()` (picks by capability/cost/flag; falls back to Mock) | — |

**Naming reconciliation:** `TourProcessor` remains the low-level *per-clip* engine (Veo,
live). `VideoGenerationProvider` is the *deliverable-level* seam the agent talks to. v1
ships `MockProvider` only; the Veo adapter and a Remotion compositor are the next slice.

### 3.2 Pipeline stages (orchestrated by `agent.ts`)

```
runVideoAgent(propertyId, ownerId):
  1. upsert job → status "pending"
  2. status "analyzing":
       ingest()      → assets[]            (validate ≥3)
       classify()    → classifications[]   (Claude vision, batched)
       quality()     → scores[]            (Claude vision + deterministic resolution)
       select()      → selectedShots[]     (pure function; throws if 0 survive)
       brief()       → visualBrief          (Claude)
       prompts()     → generationPrompts[]  (deterministic)
       deliverables()→ plannedDeliverables[](deterministic catalog)
  3. status "generating":
       selectProvider() → MockProvider (v1)
       provider.generate(...) → mock deliverables (status "mock")
  4. status "completed"  (persist full BriefPayload jsonb)
  on any throw → status "failed", persist error
```

Each stage is independently unit-testable. LLM/vision nodes are mocked in tests.

### 3.3 `BriefPayload` (the versioned jsonb)

```ts
type BriefPayload = {
  schemaVersion: 1
  assets: Array<{ photoId, url, resolution?: {w,h} }>
  classifications: Array<{ photoId, roomType, tags[], confidence }>
  scores: Array<{ photoId, sharpness, lighting, framing, overall, duplicateOf?: photoId }>
  selectedShots: Array<{ photoId, order, roomType, reason, suggestedMotion }>
  visualBrief: { summary, mood, targetBuyer, hook, narrative }
  generationPrompts: Array<{ shotOrder, photoId, prompt, guardrails }>
  deliverables: Array<{ id, kind, aspect, platform[], status: "planned"|"mock"|"approved" }>
  provider: string   // "mock" in v1
}
```

---

## 4. Data model & migration (owner applies)

Per CLAUDE.md, schema changes go through a migration + explicit owner sign-off; I author
it, Camilo runs `supabase db push` after review. **Never auto-pushed.**

`supabase migration new create_video_agent_jobs`:

```sql
create table public.video_agent_jobs (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending','analyzing','generating','completed','failed')),
  brief        jsonb,          -- BriefPayload (versioned); null until completed
  provider     text,           -- selected engine id ("mock" in v1)
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index video_agent_jobs_property_idx on public.video_agent_jobs (property_id);
create index video_agent_jobs_owner_idx    on public.video_agent_jobs (owner_id);

alter table public.video_agent_jobs enable row level security;

-- owner full manage (owner_id = auth.uid()); no public read in v1
create policy "video_agent_jobs owner select" on public.video_agent_jobs
  for select using (owner_id = auth.uid());
create policy "video_agent_jobs owner insert" on public.video_agent_jobs
  for insert with check (owner_id = auth.uid());
create policy "video_agent_jobs owner update" on public.video_agent_jobs
  for update using (owner_id = auth.uid());
```

Per-photo analysis lives inside `brief` keyed by `photoId` — **no columns added to
`property_photos`.** An `updated_at` trigger follows the existing baseline convention (or
is set explicitly in the service-client write path if the baseline has no shared trigger).

---

## 5. Endpoint & entry point

### 5.1 `POST /api/video-agent/generate`

Mirrors `/api/staging/generate` structure:

1. `VIDEO_AGENT_ENABLED` gate → 404 if off.
2. Auth (user client) → 401.
3. Rate limit `apiLimiter("video-agent:generate", 3, "1 h")` → 429 (`enforceLimit`).
4. Validate body `{ property_id }`.
5. Verify property ownership via user client (RLS) → 403.
6. Load photos; require ≥3 → 422 (`too_few_photos`).
7. Create/reset job row (`pending`) via service client.
8. Run pipeline **synchronously** (`export const maxDuration = 300`) — only LLM calls,
   no render.
9. Return `{ jobId, status, brief }`.

The `generating` stage is the documented seam where a real provider + the existing
`/api/webhooks/tour` sink plug in later (async/webhook mode already modeled by
`TourEngineMode`).

### 5.2 Read path

`GET /api/video-agent/[jobId]` (owner-scoped) **or** a server-component read on the
dashboard for status + result. (Server-component read preferred — fewer moving parts.)

### 5.3 Dashboard surface (`src/app/[lang]/dashboard`)

- A **"Generate marketing package"** button on a submitted listing (gated by
  `VIDEO_AGENT_ENABLED`, optionally Pro/Concierge tier like Living Listing).
- A `VideoBriefPanel` client component rendering: classified + scored shots, the hero
  sequence, the visual brief, per-shot prompts, and **mock deliverable cards** with
  **approve / regenerate / request-a-different-version**:
  - *approve* → persist deliverable `status: "approved"`.
  - *regenerate* → re-run the pipeline (fresh job).
  - *request-different-version* → re-run with a variant deliverable target.

---

## 6. Feature flag

No flag system exists; the codebase gates by env var (`TOUR_ENGINE`, `VEO_MODEL`). Follow
that: `VIDEO_AGENT_ENABLED` (server-read), checked in the route and the dashboard render.
Optional tier gate (Pro/Concierge) reusing the `draft?.pricing_tier` pattern from step 5.
Documented in CLAUDE.md env section on merge.

---

## 7. Validation, errors, logging

- **Validation:** reuse `src/lib/storage.ts` MIME/size conventions for any future upload;
  require ≥3 usable photos; friendly failure if 0 survive filtering.
- **Errors:** per-stage try/catch → job `failed` + `error`; route returns typed
  403 / 422 / 429 / 500. A `ProviderNotConfiguredError` from a stub adapter never reaches
  v1 (Mock is always selected) but is handled defensively.
- **Logging:** `console.log`/`error` prefixed `[video-agent]` with `jobId` and stage name;
  prod-loud like `enforceLimit`. Observable in Vercel logs.

---

## 8. Testing (Vitest — existing infra)

Pure/unit, LLM & vision calls mocked:

- `select.ts`: storytelling order, one-best-per-room, dedup removal, cap N, throws on empty.
- `prompts.ts`: guardrail clauses present; room-type → prompt mapping; no geometry-fabricating language.
- `deliverables.ts`: catalog completeness (horizontal, vertical, teaser, social variants).
- `quality.ts`: score normalization / threshold logic (deterministic parts).
- `brief.ts`: zod schema validation of model output shape (mocked model).
- `providers/index.ts`: `selectProvider()` returns Mock when others unconfigured; stubs throw.
- `agent.ts`: status transitions `pending→analyzing→generating→completed`; failure path sets `failed` + error.

Mirrors existing style (`pricing-tiers`, `buyer-rebate`, staging tests).

---

## 9. i18n

New nested key `videoAgent.*` in both `en` and `es` in `src/lib/i18n.ts`, mirroring the
`staging*` / `living*` groupings: panel labels, status strings, deliverable names, the
approve/regenerate/variant actions, and a **disclosure line** (forward-looking, for when
real generation lands).

---

## 10. Files touched (summary)

**New**
- `src/lib/media-intelligence/*` (module above)
- `src/app/api/video-agent/generate/route.ts`
- (optional) `src/app/api/video-agent/[jobId]/route.ts`
- `src/components/video-brief-panel.tsx`
- `supabase/migrations/<ts>_create_video_agent_jobs.sql`
- `src/lib/media-intelligence/**/*.test.ts`

**Modified**
- `src/app/[lang]/dashboard/page.tsx` (button + panel mount)
- `src/lib/i18n.ts` (`videoAgent.*` en/es)
- `CLAUDE.md` (env var `VIDEO_AGENT_ENABLED` documented)

**Not touched:** `property_photos` schema, the 8-step listing wizard, `tour_jobs`,
existing staging/tour routes.

---

## 11. Environment variables

- `VIDEO_AGENT_ENABLED` — `"true"` to enable route + dashboard surface (server-only).
- Reuses existing `ANTHROPIC` access via `@ai-sdk/anthropic` (already used by Loui) — no
  new key. (If Loui's key resolution differs, mirror it exactly.)
- No provider keys in v1 (stubs only). Future: `KLING_API_KEY`, `RUNWAY_API_KEY`, etc.,
  added phase by phase.

---

## 12. Compliance guardrails

- v1 generates **nothing real** — every deliverable is `mock`. No misrepresentation risk.
- The `generationPrompts` bake in the same geometry guardrails as `LIVING_LISTING_PROMPT`
  ("do not add, remove, or move walls, rooms, windows, doors, or fixtures").
- When real generation lands (next slice), it inherits the `livingDisclaimer` disclosure
  precedent and stays gated + owner-approved before anything is shown publicly.
- No public RLS read on `video_agent_jobs` in v1 — briefs are owner-only.

---

## 13. Next slices (out of scope, noted for continuity)

1. **B — Remotion composition**: render the selected shots into real horizontal/vertical/
   teaser MP4s (deterministic, no hallucination). Requires a render path decision
   (Remotion Lambda / Modal / external) + `tour-videos` bucket persistence.
2. **C — live providers**: implement Veo adapter (wrap `TourProcessor`) + real Kling/
   Runway/Luma/Higgsfield/Wan adapters, async via the tour webhook seam; add overage
   billing.
3. **D — full Seller Studio**: richer preview, variant history, publish-to-listing.
4. **Deterministic CV**: replace vision-model quality/dedupe with `sharp`/Laplacian +
   perceptual hashing where cheaper/stronger.
5. Video-file ingestion; 3D/immersive tours (E).
