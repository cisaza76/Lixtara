# Media Intelligence Agent — foundation for Lixtara's multimedia ecosystem (MVP slice)

**Status:** Approved design, pending spec review
**Date:** 2026-07-03
**Author:** Camilo Isaza + Claude
**Scope:** First vertical slice of the **Media Intelligence Agent** program

---

## 1. Context & motivation

Sellers upload imperfect phone photos. Today they manually choose which shots matter, in
what order, and how to present the property. Lixtara already has the *generation*
primitives — a pluggable per-clip video engine (`TourProcessor` + a live Veo/Gemini
"Living Listing" processor), a Luma virtual-staging pipeline, a `tour_jobs` state table, a
private `tour-videos` bucket, rate limiting, webhook idempotency, and bilingual i18n.

**What is missing is the intelligence**: nothing classifies rooms, scores quality, dedupes,
selects hero shots, or decides *how* the property should be marketed.

This slice builds that intelligence as the **Media Intelligence Agent** — deliberately
**not** a "Video Agent." Video is one output among many. The intelligence must stay
independent of the output format so the same core can, over time, drive enhanced photos,
virtual staging, object removal, renders, 3D tours, immersive walk-throughs, reels,
presentations, PDF brochures, social content, narrated audio / voice-over, multi-language
video, virtual avatars, and formats that do not exist yet.

v1 produces a real, demoable output — classified + scored shots, a hero sequence, and a
**Media Strategy** decision document (the "mind"), plus per-shot prompts and a job that
runs through every state — with a **mock render** standing in for the final deliverable. It
introduces **no new heavy infra, no external spend, and no compliance risk**, and plugs
into the existing `TourProcessor` / `tour_jobs` / `tour-videos` primitives.

### The program, decomposed (for reference)

- **A — Media Intelligence core** ← *this slice* (analysis + Media Strategy + orchestration skeleton)
- **B — Composition Engine** (Remotion, deterministic reels from real photos) — next
- **C — `MediaGenerationProvider` live adapters** — skeleton here, live providers next
- **D — Seller Studio UX** — thin surface here, full studio later
- **E — Specialist agents** (Photo / Presentation / Tour / Social / Copy / Voice…) — interfaces + registry here, real specialists later
- **F — 3D / immersive tours** — deferred (KIRI removed; `tour_jobs` preserved)

---

## 2. Confirmed decisions (MVP baseline)

1. Concept is the **Media Intelligence Agent**, format-agnostic. Video is one output type.
2. Provider abstraction is a **`MediaGenerationProvider`** hierarchy; `VideoProvider`,
   `ImageProvider`, `PresentationProvider`, `TourProvider`, `ThreeDProvider`,
   `VoiceProvider` hang off it. Never video-centric at the root.
3. The agent produces a structured **Media Strategy** (aka Creative Brief) decision
   document — the "mind" all generators consume. **Generators execute; they do not think.**
4. Architecture is **prepared for multiple specialist agents** (Photo / Video /
   Presentation / Tour / Social / Copy / Virtual-Staging / Voice) coordinated by the Media
   Intelligence Agent. v1 ships the specialist *interface + registry + one reference
   (mock) specialist + registered stubs* — not all specialists built.
5. Single table `media_agent_jobs`; the full analysis + strategy live in a **versioned
   `jsonb` payload**. No schema churn on `property_photos`.
6. v1 = **intelligence + mock render**. No real MP4/asset generation yet.
7. **Deterministic pipeline with LLM at specific nodes**, not an autonomous agent loop.
8. **Extend** the existing `TourProcessor`, `tour_jobs`, `tour-videos`, and staging
   pipeline — do not reinvent them.
9. Gated behind **`MEDIA_AGENT_ENABLED`** (renamed from `VIDEO_AGENT_ENABLED` to match the
   media-generic concept). **Open to any seller during beta** while the flag is on — no
   tier gate in v1; capabilities become plan-differentiated later.
10. External providers stay adapters/stubs: Veo (wraps existing processor, video), Kling,
    Runway, Luma, Higgsfield, Wan (video), plus placeholder image/presentation/tour/voice
    providers.
11. **Not** in this slice: Remotion, real generation of any media, video-file ingestion,
    3D tours, overage billing.
12. **Compliance first**: never publish a generated view that could misrepresent the
    property. v1 renders nothing real. Real generation (later) inherits
    `LIVING_LISTING_PROMPT`-style geometry guardrails + the `livingDisclaimer` disclosure.

### Read-path decision (from review)

Dashboard reads job state/result via a **Server Component** (fewest moving parts). The
architecture leaves room to add `GET /api/media-agent/[jobId]` later **without breaking
compatibility** — not implemented now.

### Quality/dedupe decision (from review)

v1 uses **Claude Vision** for sharpness / lighting / framing / near-duplicates. The
`quality.ts` module exposes an explicit, documented extension point so a **deterministic CV
layer** (`sharp` / Laplacian / perceptual hash) can replace it later without touching
callers.

---

## 3. Architecture

Deterministic pipeline, LLM invoked only at specific nodes. Orchestration is plain,
testable code — reproducible, predictable cost, easy to debug. The **intelligence is
independent of any output format**; format-specific work lives behind specialist agents and
providers.

### 3.1 Layering

```
                 ┌─────────────────────────────────────────────┐
                 │   Media Intelligence Agent  (agent.ts)       │
                 │   analyze → Media Strategy → dispatch        │
                 └───────────────┬─────────────────────────────┘
        analysis pipeline        │        specialist dispatch
  (ingest→classify→quality→      │   ┌──────────────────────────────┐
   select→strategy→prompts)      │   │  Media Specialist registry   │
                                 └──▶│  Video / Photo / Presentation │
                                     │  Tour / Social / Copy / Voice │
                                     └───────────────┬──────────────┘
                                                     │ uses
                                     ┌───────────────▼──────────────┐
                                     │  MediaGenerationProvider      │
                                     │  Video/Image/Presentation/... │
                                     │  Mock (v1) · Veo · stubs      │
                                     └───────────────────────────────┘
```

- **Media Intelligence Agent** = the format-agnostic core. Runs the analysis pipeline,
  produces the **Media Strategy**, then dispatches to specialists per the strategy's
  recommended outputs. It is the only "thinking" component.
- **Media Specialists** = per-capability executors (Video, Photo, Presentation, Tour,
  Social, Copy, Voice…). Each reads the Media Strategy and executes via a provider. They do
  not re-decide strategy. v1: interface + registry + a reference **Video specialist (mock
  output)** + registered stub specialists.
- **MediaGenerationProvider** = the engine seam. Base interface + capability sub-interfaces.
  v1: `MockProvider` (implements every capability, placeholder output) + a Veo adapter
  (wraps `TourProcessor`, `VideoProvider`, registered but not invoked) + `NotConfigured`
  stubs.

### 3.2 New module: `src/lib/media-intelligence/`

**Core / analysis**

| File | Responsibility | Engine |
|---|---|---|
| `types.ts` | `Asset`, `Classification`, `QualityScore`, `SelectedShot`, `MediaStrategy`, `Deliverable`, `MediaCapability`, `MediaJobStatus`, `StrategyPayload` (versioned) | — |
| `ingest.ts` | Load `property_photos` for a listing; validate count (≥3) and URL presence | deterministic |
| `classify.ts` | Room/type + tags per photo (fachada, sala, cocina, baño, exterior, amenity, lote, aérea, plano, render, otro) | Claude Vision (`@ai-sdk/anthropic`, `generateObject` + zod) |
| `quality.ts` | Sharpness / lighting / framing / near-duplicate scores; resolution deterministic. **Documented extension point** for deterministic CV | Claude Vision (v1) |
| `select.ts` | Hero sequence in real-estate storytelling order, one best per room, drop low-quality/dupes, cap N | **pure function** |
| `strategy.ts` | Produce the **Media Strategy** decision document (see §3.4) from analysis + listing facts + a deterministic cost table | Claude (`generateObject` + zod) + deterministic cost calc |
| `prompts.ts` | Per-shot generation prompts, real-estate geometry guardrails (mirrors `LIVING_LISTING_PROMPT`) | deterministic templates |
| `deliverables.ts` | Media-generic catalog of planned outputs (video/image/presentation/tour/social…), keyed by `MediaCapability` | deterministic |
| `agent.ts` | Media Intelligence Agent orchestrator: status transitions, persist payload, dispatch to specialists, log `[media-agent]` | plain code |

**Providers — `src/lib/media-intelligence/providers/`**

| File | Responsibility |
|---|---|
| `types.ts` | `MediaGenerationProvider` base + `VideoProvider`, `ImageProvider`, `PresentationProvider`, `TourProvider`, `ThreeDProvider`, `VoiceProvider` sub-interfaces; `MediaCapability` mapping; `ProviderNotConfiguredError` |
| `mock.ts` | `MockProvider` — implements every capability, returns placeholder deliverables; always available |
| `veo.ts` | `VideoProvider` adapter wrapping the existing `TourProcessor`/Veo engine (registered, not invoked in v1) |
| `stubs.ts` | Kling / Runway / Luma / Higgsfield / Wan (video) + placeholder image/presentation/tour/voice providers → throw `ProviderNotConfiguredError` |
| `cost-table.ts` | Deterministic per-provider/per-capability cost estimates (source of truth for `estimatedCostUsd`) |
| `index.ts` | Registry + `selectProvider(capability, opts)` — picks a configured provider by capability/cost/flag; falls back to Mock |

**Specialists — `src/lib/media-intelligence/agents/`**

| File | Responsibility |
|---|---|
| `types.ts` | `MediaSpecialist` interface: `{ id, capability, plan(strategy) → Deliverable[], execute(deliverable, provider) → result }` |
| `registry.ts` | Register / look up specialists by `MediaCapability` |
| `video-specialist.ts` | Reference specialist: reads strategy, plans video deliverables, executes via `selectProvider("video")` → **MockProvider output in v1** |
| `stub-specialist.ts` | Factory `makeStubSpecialist(capability)` registered for photo / presentation / tour / social / copy / voice — returns "planned/mock", never throws in v1 |

**Naming reconciliation:** `TourProcessor` stays the low-level *per-clip* engine (Veo,
live). `MediaGenerationProvider` is the *deliverable-level* seam specialists talk to. v1
exercises `MockProvider` only.

### 3.3 Pipeline (orchestrated by `agent.ts`)

```
runMediaAgent(propertyId, ownerId):
  1. upsert job → "pending"
  2. "analyzing":
       ingest()   → assets[]            (validate ≥3)
       classify() → classifications[]   (Claude Vision, batched)
       quality()  → scores[]            (Claude Vision + deterministic resolution)
       select()   → selectedShots[]     (pure; throws if 0 survive)
       strategy() → mediaStrategy        (Claude + deterministic cost table)
       prompts()  → generationPrompts[]  (deterministic)
       deliverables() → plannedDeliverables[]  (deterministic, per capability)
  3. "generating":
       for each recommended output in mediaStrategy:
         specialist = registry.get(capability)
         specialist.plan(strategy) → deliverables
         specialist.execute(deliverable, selectProvider(capability))  // Mock in v1
  4. "completed"  (persist full StrategyPayload jsonb)
  on any throw → "failed", persist error
```

Each stage is independently unit-testable; LLM/vision nodes are mocked in tests.

### 3.4 The Media Strategy (the "mind")

Structured document produced by `strategy.ts`, consumed by every specialist. Zod-validated
shape; the LLM writes the qualitative fields, deterministic code fills cost:

```ts
type MediaStrategy = {
  targetAudience: string          // who is this property for
  buyerPersona: string            // what kind of buyer it appears to attract
  emotions: string[]              // emotions to evoke
  highlightSpaces: string[]       // room types / features to feature
  hideSpaces: string[]            // weak spaces to de-emphasize or omit
  narrativeOrder: string[]        // ordered story beats (room types)
  visualStyle: string             // e.g. "warm editorial", "bright modern"
  recommendedPlatforms: Array<{ platform, rationale }>   // where it will perform best
  recommendedDurationSec: number  // target video length
  recommendedOutputs: Array<{     // which deliverables + engines to produce
    capability: MediaCapability   // "video" | "image" | "presentation" | ...
    engine: string                // recommended provider id
    estimatedCostUsd: number      // from deterministic cost table, NOT the LLM
  }>
  bestRoiCombination: string[]    // deliverable ids giving best ROI
  rationale: string               // why these choices
}
```

**Cost integrity:** `estimatedCostUsd` and any pricing come from the deterministic
`cost-table.ts`, never from the LLM — prices must not be hallucinated.

### 3.5 `StrategyPayload` (the versioned jsonb)

```ts
type StrategyPayload = {
  schemaVersion: 1
  assets: Array<{ photoId, url, resolution?: {w,h} }>
  classifications: Array<{ photoId, roomType, tags[], confidence }>
  scores: Array<{ photoId, sharpness, lighting, framing, overall, duplicateOf?: photoId }>
  selectedShots: Array<{ photoId, order, roomType, reason, suggestedMotion }>
  mediaStrategy: MediaStrategy
  generationPrompts: Array<{ shotOrder, photoId, prompt, guardrails }>
  deliverables: Array<{ id, capability, kind, aspect, platform[], status: "planned"|"mock"|"approved", specialistId }>
  providersUsed: Record<MediaCapability, string>   // "mock" in v1
}
```

---

## 4. Data model & migration (owner applies)

Per CLAUDE.md, schema changes go through a migration + explicit owner sign-off; Claude
authors it, Camilo runs `supabase db push` after review. **Never auto-pushed.**

`supabase migration new create_media_agent_jobs`:

```sql
create table public.media_agent_jobs (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending','analyzing','generating','completed','failed')),
  strategy     jsonb,          -- StrategyPayload (versioned); null until completed
  providers    text,           -- summary of engines used ("mock" in v1)
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index media_agent_jobs_property_idx on public.media_agent_jobs (property_id);
create index media_agent_jobs_owner_idx    on public.media_agent_jobs (owner_id);

alter table public.media_agent_jobs enable row level security;

-- owner full manage (owner_id = auth.uid()); no public read in v1
create policy "media_agent_jobs owner select" on public.media_agent_jobs
  for select using (owner_id = auth.uid());
create policy "media_agent_jobs owner insert" on public.media_agent_jobs
  for insert with check (owner_id = auth.uid());
create policy "media_agent_jobs owner update" on public.media_agent_jobs
  for update using (owner_id = auth.uid());
```

Per-photo analysis lives inside `strategy` keyed by `photoId` — **no columns added to
`property_photos`.** `updated_at` set in the service-client write path (or via a shared
trigger if the baseline provides one).

---

## 5. Endpoint & entry point

### 5.1 `POST /api/media-agent/generate`

Mirrors `/api/staging/generate`:

1. `MEDIA_AGENT_ENABLED` gate → 404 if off.
2. Auth (user client) → 401.
3. Rate limit `apiLimiter("media-agent:generate", 3, "1 h")` → 429 (`enforceLimit`).
4. Validate body `{ property_id }`.
5. Verify property ownership via user client (RLS) → 403.
6. Load photos; require ≥3 → 422 (`too_few_photos`).
7. Create/reset job row (`pending`) via service client.
8. Run pipeline **synchronously** (`export const maxDuration = 300`) — only LLM calls, no
   render.
9. Return `{ jobId, status, strategy }`.

The `generating` stage is the documented seam where real providers + the existing
`/api/webhooks/tour` sink plug in later (async/webhook mode already modeled by
`TourEngineMode`).

### 5.2 Read path

Dashboard **Server Component** reads the latest `media_agent_jobs` row for a property.
`GET /api/media-agent/[jobId]` is intentionally deferred — the return shape from
`/generate` and the read component share the same `StrategyPayload` type, so adding the
`GET` later is non-breaking.

### 5.3 Dashboard surface (`src/app/[lang]/dashboard`)

- A **"Generate marketing package"** button on a submitted listing (gated by
  `MEDIA_AGENT_ENABLED`; **no tier gate in beta**).
- A `MediaStrategyPanel` client component rendering: classified + scored shots, the hero
  sequence, the **Media Strategy** (audience, persona, emotions, highlight/hide spaces,
  narrative order, style, platforms, duration, recommended engines + estimated cost, ROI
  combo), per-shot prompts, and **mock deliverable cards** with **approve / regenerate /
  request-a-different-version**:
  - *approve* → persist deliverable `status: "approved"`.
  - *regenerate* → re-run the pipeline (fresh job).
  - *request-different-version* → re-run targeting a different deliverable capability/style.

---

## 6. Feature flag

Env-var gating, consistent with the codebase (`TOUR_ENGINE`, `VEO_MODEL`):
**`MEDIA_AGENT_ENABLED`** (server-read), checked in the route and dashboard render. No tier
gate during beta. Documented in CLAUDE.md env section on merge.

---

## 7. Validation, errors, logging

- **Validation:** reuse `src/lib/storage.ts` MIME/size conventions for any future upload;
  require ≥3 usable photos; friendly failure if 0 survive filtering.
- **Errors:** per-stage try/catch → job `failed` + `error`; route returns typed
  403 / 422 / 429 / 500. `ProviderNotConfiguredError` is handled defensively (Mock is always
  selected in v1, so it should never surface).
- **Logging:** `console.log`/`error` prefixed `[media-agent]` with `jobId` + stage name;
  prod-loud like `enforceLimit`. Observable in Vercel logs.

---

## 8. Testing (Vitest — existing infra)

Pure/unit, LLM & vision calls mocked:

- `select.ts`: storytelling order, one-best-per-room, dedup removal, cap N, throws on empty.
- `prompts.ts`: geometry-guardrail clauses present; room-type → prompt mapping.
- `deliverables.ts`: catalog covers each `MediaCapability`.
- `quality.ts`: score normalization / threshold logic (deterministic parts) + extension-point contract.
- `strategy.ts`: zod validation of model output; cost fields come from the cost table, not the model.
- `providers/index.ts`: `selectProvider()` returns Mock when others unconfigured; stubs throw `ProviderNotConfiguredError`.
- `providers/cost-table.ts`: deterministic cost lookups.
- `agents/registry.ts`: specialist lookup by capability; stub specialists registered.
- `agent.ts`: status transitions `pending→analyzing→generating→completed`; failure path sets `failed` + error.

Mirrors existing style (`pricing-tiers`, `buyer-rebate`, staging tests).

---

## 9. i18n

New nested key `mediaAgent.*` in both `en` and `es` in `src/lib/i18n.ts`, mirroring the
`staging*` / `living*` groupings: panel labels, status strings, Media Strategy field
labels, deliverable/capability names, the approve/regenerate/variant actions, and a
**disclosure line** (forward-looking, for when real generation lands).

---

## 10. Build sequence (for the implementation plan)

Per project methodology — **architecture → interfaces → persistence → orchestration → UI**,
always preserving existing infra and flows:

1. **Architecture & types** — `types.ts` (capabilities, statuses, `MediaStrategy`,
   `StrategyPayload`), provider + specialist interfaces. No behavior yet.
2. **Interfaces & stubs** — `MediaGenerationProvider` hierarchy + `MockProvider` + Veo
   adapter + stubs + `cost-table.ts`; specialist registry + reference + stub specialists.
   Fully unit-tested against mocks.
3. **Persistence** — migration `create_media_agent_jobs` (author only; owner applies) +
   service-client read/write helpers.
4. **Orchestration** — analysis stages (`ingest/classify/quality/select/strategy/prompts/
   deliverables`) + `agent.ts` + the `POST /api/media-agent/generate` route. End-to-end
   with Mock, behind `MEDIA_AGENT_ENABLED`.
5. **UI integration** — dashboard button + `MediaStrategyPanel` + i18n; Server-Component
   read path.

Each step passes the five quality gates (`tsc`, `lint`, `test`, `migrations:check`,
`build`) before the next.

---

## 11. Files touched (summary)

**New**
- `src/lib/media-intelligence/**` (core, providers, agents — module above)
- `src/app/api/media-agent/generate/route.ts`
- `src/components/media-strategy-panel.tsx`
- `supabase/migrations/<ts>_create_media_agent_jobs.sql`
- `src/lib/media-intelligence/**/*.test.ts`

**Modified**
- `src/app/[lang]/dashboard/page.tsx` (button + panel mount)
- `src/lib/i18n.ts` (`mediaAgent.*` en/es)
- `CLAUDE.md` (env var `MEDIA_AGENT_ENABLED` documented)

**Not touched:** `property_photos` schema, the 8-step listing wizard, `tour_jobs`,
existing staging/tour routes.

---

## 12. Environment variables

- `MEDIA_AGENT_ENABLED` — `"true"` to enable route + dashboard surface (server-only).
- Reuses existing Anthropic access via `@ai-sdk/anthropic` (already used by Loui) — no new
  key. (Mirror Loui's key resolution exactly.)
- No provider keys in v1 (stubs only). Future: `KLING_API_KEY`, `RUNWAY_API_KEY`,
  `HIGGSFIELD_API_KEY`, `WAN_API_KEY`, etc., added phase by phase.

---

## 13. Compliance guardrails

- v1 generates **nothing real** — every deliverable is `mock`. No misrepresentation risk.
- `generationPrompts` bake in the geometry guardrails of `LIVING_LISTING_PROMPT` ("do not
  add, remove, or move walls, rooms, windows, doors, or fixtures").
- When real generation lands (later slice), it inherits the `livingDisclaimer` disclosure
  precedent and stays gated + owner-approved before anything is shown publicly.
- No public RLS read on `media_agent_jobs` in v1 — strategies are owner-only.
- The Media Strategy may recommend *de-emphasizing* weak spaces but must never fabricate or
  conceal material defects in a way that misrepresents the property.

---

## 14. Next slices (out of scope, noted for continuity)

1. **B — Remotion composition**: render selected shots into real horizontal/vertical/teaser
   MP4s (deterministic, no hallucination). Needs a render-path decision (Remotion Lambda /
   Modal / external) + `tour-videos` persistence.
2. **C — live providers**: implement the Veo adapter for real, then Kling / Runway / Luma /
   Higgsfield / Wan, async via the tour webhook seam; add overage billing.
3. **E — real specialists**: build Photo, Presentation, Tour, Social, Copy, Voice
   specialists against the interfaces defined here; add their providers (image, TTS/voice,
   presentation/PDF).
4. **D — full Seller Studio**: richer preview, variant history, publish-to-listing.
5. **Deterministic CV**: replace vision-model quality/dedupe with `sharp` / Laplacian /
   perceptual hashing via the `quality.ts` extension point.
6. **Plan-differentiated capabilities**: move from open beta to tier-gated capabilities +
   per-plan rate limits tied to real inference cost.
7. Video-file ingestion; multi-language video, voice-over, avatars; 3D / immersive tours (F).
