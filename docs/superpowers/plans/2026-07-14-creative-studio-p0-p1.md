# Lixtara Creative Studio — P0 + P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Media Intelligence layer decide, **per capability**, whether a listing is
*ready* to produce it and whether it is *recommended* — with structured, localized reasons and
one concrete suggested action each — never generating or touching a provider for a suppressed
capability (P1). Prepare the production foundation in an agent-verifiable way without taking
any external action (P0-A); leave the external actions as an owner checklist (P0-B).

**Architecture:** The orchestrator `runMediaAgent` (deterministic control flow, LLM only in
injected deps) gains a **readiness gate** after the LLM strategy and before any generation. A
pure module evaluates each capability independently and returns `CapabilityReadiness` objects
with two orthogonal axes — `status: ready|not_ready` (hard) and `recommendation:
recommended|not_recommended` (soft) — plus structured `reasons`/`suggestedActions`. Only
`ready && recommended` capabilities auto-dispatch (still mock in P1); the full readiness array
is persisted and surfaced in the Studio panel. No new provider, no migration, no real media.

**Tech Stack:** TypeScript (strict), Vitest (node env, `@/` alias), Next.js 16 App Router,
`@ai-sdk/anthropic` (already wired), Supabase.

## Global Constraints

- All gates pass before each commit: `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`,
  `pnpm migrations:check`, `pnpm build`.
- Product name is **"Lixtara Creative Studio"** in user-facing copy. **Never leak internal
  terms** (readiness, suppression, provider, "Media Agent") to the UI. Code identifiers stay
  unchanged in P0 (`MEDIA_AGENT_ENABLED`, `media_agent_jobs`, `/api/media-agent/*`).
- **Readiness ≠ entitlement ≠ cost ≠ provider selection.** Readiness only answers: do the
  assets + listing state allow producing this capability at acceptable quality? It never reads
  the plan, price, or provider.
- **Per capability, never a global `listingReady`.** Evaluate each capability independently.
- **`status` is a hard gate** (no override in P1). **`recommendation` is soft** (advisory;
  override machinery is a later phase — do NOT build it here).
- **Reason/action codes are stable enum data + params, never free text.** Multiple reasons may
  apply at once. The UI localizes codes (EN + ES) and interpolates params.
- **Deterministic + LLM-free.** The LLM may recommend outputs; it can never skip the readiness
  gate. A suppressed capability must never touch an asset or run a provider.
- **No DB schema change.** Readiness data lives in the existing `media_agent_jobs.payload`
  jsonb. No migration in P1.
- TDD: failing test first → watch it fail → minimal implementation → watch it pass → commit.

## Per-task process (subagent-driven, mandatory)

1. Implementation subagent runs the task's TDD steps.
2. Full run of the relevant tests.
3. Independent review against this plan + the architecture spec.
4. Code-quality review: types, edge cases, i18n, no internal terms leaked, no placeholders.
5. Fix all findings before advancing.
6. One atomic commit per task.

---

## P0-A — Agent-verifiable technical prep (safe; NO external actions)

Runnable by the agent now, but **not part of this execution run** (owner asked for P1 only).
Listed so P0 is fully modeled and ready to prepare on request. None of these merge, deploy,
apply a migration, or change Vercel.

- [ ] **P0-A.1 — Fails-closed test:** add a test asserting `POST /api/media-agent/generate`
      returns 404 when `MEDIA_AGENT_ENABLED` is unset (the flag defaults closed via
      `isMediaAgentEnabled()`), and that no mock output is reachable while off.
- [ ] **P0-A.2 — Activation runbook:** write `docs/superpowers/runbooks/2026-07-14-creative-studio-activation.md`
      documenting: migration idempotency review (does `20260703232736_create_media_agent_jobs.sql`
      use `IF NOT EXISTS` / safe to re-run?), the rollback statement, the fails-closed evidence,
      confirmation no mock is user-visible when off, and the ordered external steps below.

## P0-B — External actions (OWNER ONLY — do not execute)

- [ ] Merge PR #81 (`feat/video-agent-media-intelligence` → `main`).
- [ ] `supabase db push` to apply `media_agent_jobs` after sign-off; confirm via
      `supabase migration list`.
- [ ] `vercel env add MEDIA_AGENT_ENABLED=true` (Production + Preview).
- [ ] Activate / verify in production.

---

## Task 1: Readiness model — per-capability, ready-vs-recommended, structured codes (pure)

**Files:**
- Modify: `src/lib/media-intelligence/types.ts` (readiness types + codes)
- Create: `src/lib/media-intelligence/readiness.ts`
- Test: `src/lib/media-intelligence/readiness.test.ts`

**Interfaces:**
- Consumes: `Classification`, `QualityScore`, `MediaCapability`, `RoomType` from `types.ts`.
- Produces (in `types.ts`):
  - `READINESS_REASON_CODES` / `ReadinessReasonCode`, `SUGGESTED_ACTION_CODES` / `SuggestedActionCode`
  - `interface ReadinessReason { code: ReadinessReasonCode; params?: Record<string, number | string> }`
  - `interface SuggestedAction { code: SuggestedActionCode; params?: Record<string, number | string> }`
  - `interface CapabilityReadiness { capability: MediaCapability; status: "ready" | "not_ready"; recommendation: "recommended" | "not_recommended"; reasons: ReadinessReason[]; suggestedActions: SuggestedAction[] }`
- Produces (in `readiness.ts`):
  - `const MIN_TOUR_PHOTOS = 8`, `const MIN_USABLE_QUALITY = 0.45`, `const RECOMMEND_MIN_INTERIORS = 3`
  - `interface ReadinessContext { photoCount: number; scores: QualityScore[]; classifications: Classification[]; listingApproved: boolean }`
  - `evaluateCapabilityReadiness(capability: MediaCapability, ctx: ReadinessContext): CapabilityReadiness`
  - `evaluateReadiness(capabilities: readonly MediaCapability[], ctx: ReadinessContext): CapabilityReadiness[]`

- [ ] **Step 1: Add readiness types + codes**

In `src/lib/media-intelligence/types.ts`, after the `RecommendedOutput` interface (lines
52-56), add:

```ts
export const READINESS_REASON_CODES = [
  "too_few_photos_for_tour",
  "listing_not_approved",
  "no_interior_photos",
  "few_interior_photos",
  "low_photo_quality",
] as const;
export type ReadinessReasonCode = (typeof READINESS_REASON_CODES)[number];

export const SUGGESTED_ACTION_CODES = [
  "add_more_photos",
  "add_interior_photos",
  "await_listing_approval",
  "improve_photo_quality",
] as const;
export type SuggestedActionCode = (typeof SUGGESTED_ACTION_CODES)[number];

export interface ReadinessReason {
  code: ReadinessReasonCode;
  params?: Record<string, number | string>;
}
export interface SuggestedAction {
  code: SuggestedActionCode;
  params?: Record<string, number | string>;
}
export interface CapabilityReadiness {
  capability: MediaCapability;
  status: "ready" | "not_ready";
  recommendation: "recommended" | "not_recommended";
  reasons: ReadinessReason[];
  suggestedActions: SuggestedAction[];
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/media-intelligence/readiness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  evaluateCapabilityReadiness,
  evaluateReadiness,
  MIN_TOUR_PHOTOS,
  RECOMMEND_MIN_INTERIORS,
} from "@/lib/media-intelligence/readiness";
import type { Classification, QualityScore } from "@/lib/media-intelligence/types";

const good: QualityScore = { photoId: "p1", sharpness: 0.8, lighting: 0.8, framing: 0.8, overall: 0.8 };
const interior = (id: string): Classification => ({ photoId: id, roomType: "sala", tags: [], confidence: 0.9 });
const exterior = (id: string): Classification => ({ photoId: id, roomType: "fachada", tags: [], confidence: 0.9 });
const interiors = (n: number) => Array.from({ length: n }, (_, i) => interior(`i${i}`));

describe("evaluateCapabilityReadiness", () => {
  it("marks a tour not_ready with a structured reason + action when photos are too few", () => {
    const r = evaluateCapabilityReadiness("tour", { photoCount: 4, scores: [good], classifications: interiors(4), listingApproved: true });
    expect(r.status).toBe("not_ready");
    expect(r.recommendation).toBe("not_recommended");
    expect(r.reasons).toEqual([{ code: "too_few_photos_for_tour", params: { min: MIN_TOUR_PHOTOS, have: 4 } }]);
    expect(r.suggestedActions[0].code).toBe("add_more_photos");
  });

  it("marks a tour ready when it has enough photos", () => {
    const r = evaluateCapabilityReadiness("tour", { photoCount: MIN_TOUR_PHOTOS, scores: [good], classifications: interiors(MIN_TOUR_PHOTOS), listingApproved: true });
    expect(r.status).toBe("ready");
    expect(r.reasons).toEqual([]);
  });

  it("blocks video with BOTH reasons when unapproved and no interiors", () => {
    const r = evaluateCapabilityReadiness("video", { photoCount: 6, scores: [good], classifications: [exterior("e1")], listingApproved: false });
    expect(r.status).toBe("not_ready");
    const codes = r.reasons.map((x) => x.code);
    expect(codes).toContain("listing_not_approved");
    expect(codes).toContain("no_interior_photos");
  });

  it("keeps video ready but NOT recommended when interiors are thin", () => {
    const r = evaluateCapabilityReadiness("video", { photoCount: 6, scores: [good], classifications: [interior("i0"), exterior("e1")], listingApproved: true });
    expect(r.status).toBe("ready");
    expect(r.recommendation).toBe("not_recommended");
    expect(r.reasons.map((x) => x.code)).toContain("few_interior_photos");
  });

  it("recommends video when approved with enough interiors", () => {
    const r = evaluateCapabilityReadiness("video", { photoCount: 8, scores: [good], classifications: interiors(RECOMMEND_MIN_INTERIORS), listingApproved: true });
    expect(r.status).toBe("ready");
    expect(r.recommendation).toBe("recommended");
    expect(r.reasons).toEqual([]);
  });

  it("marks image not_ready when the best photo quality is too low", () => {
    const bad: QualityScore = { photoId: "p1", sharpness: 0.1, lighting: 0.1, framing: 0.1, overall: 0.2 };
    const r = evaluateCapabilityReadiness("image", { photoCount: 5, scores: [bad], classifications: interiors(5), listingApproved: true });
    expect(r.status).toBe("not_ready");
    expect(r.reasons[0].code).toBe("low_photo_quality");
  });
});

describe("evaluateReadiness", () => {
  it("evaluates each capability independently and de-dupes", () => {
    const list = evaluateReadiness(["video", "tour", "video"], { photoCount: 4, scores: [good], classifications: interiors(4), listingApproved: true });
    expect(list.map((r) => r.capability)).toEqual(["video", "tour"]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/media-intelligence/readiness.test.ts`
Expected: FAIL — `Cannot find module '@/lib/media-intelligence/readiness'`.

- [ ] **Step 4: Implement the module**

Create `src/lib/media-intelligence/readiness.ts`:

```ts
// Deterministic, LLM-free readiness. Answers ONLY: do the assets + listing state allow
// producing this capability at acceptable quality? Two orthogonal axes — `status` (hard)
// and `recommendation` (soft). Never reads plan, cost, or provider. Runs before any spend.
import type {
  CapabilityReadiness,
  Classification,
  MediaCapability,
  QualityScore,
  ReadinessReason,
  RoomType,
  SuggestedAction,
} from "@/lib/media-intelligence/types";

export const MIN_TOUR_PHOTOS = 8;
export const MIN_USABLE_QUALITY = 0.45;    // QualityScore.overall (0..1) floor to be READY for image work
export const RECOMMEND_MIN_INTERIORS = 3;  // interiors below this → video is ready but NOT recommended

const INTERIOR_ROOMS: ReadonlySet<RoomType> = new Set<RoomType>([
  "sala", "cocina", "habitacion", "bano",
]);

export interface ReadinessContext {
  photoCount: number;
  scores: QualityScore[];
  classifications: Classification[];
  listingApproved: boolean;
}

export function evaluateCapabilityReadiness(
  capability: MediaCapability,
  ctx: ReadinessContext,
): CapabilityReadiness {
  const reasons: ReadinessReason[] = [];
  const suggestedActions: SuggestedAction[] = [];
  let status: "ready" | "not_ready" = "ready";
  let recommendation: "recommended" | "not_recommended" = "recommended";

  const interiorCount = ctx.classifications.filter((c) => INTERIOR_ROOMS.has(c.roomType)).length;
  const bestQuality = ctx.scores.reduce((m, s) => Math.max(m, s.overall), 0);

  if (capability === "tour" || capability === "three_d") {
    if (ctx.photoCount < MIN_TOUR_PHOTOS) {
      status = "not_ready";
      reasons.push({ code: "too_few_photos_for_tour", params: { min: MIN_TOUR_PHOTOS, have: ctx.photoCount } });
      suggestedActions.push({ code: "add_more_photos", params: { min: MIN_TOUR_PHOTOS } });
    }
  }

  if (capability === "video") {
    if (!ctx.listingApproved) {
      status = "not_ready";
      reasons.push({ code: "listing_not_approved" });
      suggestedActions.push({ code: "await_listing_approval" });
    }
    if (interiorCount === 0) {
      status = "not_ready";
      reasons.push({ code: "no_interior_photos" });
      suggestedActions.push({ code: "add_interior_photos", params: { min: RECOMMEND_MIN_INTERIORS } });
    } else if (interiorCount < RECOMMEND_MIN_INTERIORS) {
      recommendation = "not_recommended"; // ready but weak — advise, do not block
      reasons.push({ code: "few_interior_photos", params: { have: interiorCount, want: RECOMMEND_MIN_INTERIORS } });
      suggestedActions.push({ code: "add_interior_photos", params: { min: RECOMMEND_MIN_INTERIORS } });
    }
  }

  if (capability === "image") {
    if (bestQuality < MIN_USABLE_QUALITY) {
      status = "not_ready";
      reasons.push({ code: "low_photo_quality" });
      suggestedActions.push({ code: "improve_photo_quality" });
    }
  }

  if (status === "not_ready") recommendation = "not_recommended";

  return { capability, status, recommendation, reasons, suggestedActions };
}

export function evaluateReadiness(
  capabilities: readonly MediaCapability[],
  ctx: ReadinessContext,
): CapabilityReadiness[] {
  const seen = new Set<MediaCapability>();
  const out: CapabilityReadiness[] = [];
  for (const cap of capabilities) {
    if (seen.has(cap)) continue;
    seen.add(cap);
    out.push(evaluateCapabilityReadiness(cap, ctx));
  }
  return out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/media-intelligence/readiness.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/media-intelligence/types.ts src/lib/media-intelligence/readiness.ts src/lib/media-intelligence/readiness.test.ts
git commit -m "feat(media): per-capability readiness (status vs recommendation, structured codes)"
```

---

## Task 2: Wire readiness into the orchestrator; suppress before generation

**Files:**
- Modify: `src/lib/media-intelligence/types.ts` (add `readiness` to `StrategyPayload`)
- Modify: `src/lib/media-intelligence/strategy.ts` (add `approved` to `ListingFacts`)
- Modify: `src/lib/media-intelligence/strategy.test.ts` (facts include `approved`)
- Modify: `src/lib/media-intelligence/agent.ts` (evaluate readiness, filter, persist)
- Modify: `src/app/api/media-agent/generate/route.ts` (pass `approved` from listing status)
- Test: `src/lib/media-intelligence/agent.readiness.test.ts`

**Interfaces:**
- Consumes: `evaluateReadiness`, `ReadinessContext` (Task 1); `runMediaAgent`, `AgentDeps`
  (`agent.ts`); `ListingFacts` (`strategy.ts`); `StrategyPayload`, `CapabilityReadiness`.
- Produces: `StrategyPayload.readiness: CapabilityReadiness[]`; `ListingFacts.approved: boolean`.

- [ ] **Step 1: Add `readiness` to `StrategyPayload`**

In `types.ts`, inside `interface StrategyPayload` (lines 116-126), add after `deliverables`:

```ts
  deliverables: Deliverable[];
  readiness: CapabilityReadiness[];
```

- [ ] **Step 2: Add `approved` to `ListingFacts`**

In `strategy.ts`:

```ts
export interface ListingFacts {
  price: number;
  beds: number;
  baths: number;
  city: string;
  approved: boolean;
}
```

- [ ] **Step 3: Write the failing orchestrator test**

Create `src/lib/media-intelligence/agent.readiness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runMediaAgent, type AgentDeps } from "@/lib/media-intelligence/agent";
import type { Asset, Classification, MediaStrategy, QualityScore } from "@/lib/media-intelligence/types";

function makeDeps(over: Partial<AgentDeps> = {}, approved = false): AgentDeps {
  const assets: Asset[] = [{ photoId: "p1", url: "u" }];
  const classifications: Classification[] = [{ photoId: "p1", roomType: "sala", tags: [], confidence: 0.9 }];
  const scores: QualityScore[] = [{ photoId: "p1", sharpness: 0.8, lighting: 0.8, framing: 0.8, overall: 0.8 }];
  const strategy: MediaStrategy = {
    targetAudience: "", buyerPersona: "", emotions: [], highlightSpaces: [], hideSpaces: [],
    narrativeOrder: [], visualStyle: "", recommendedPlatforms: [], recommendedDurationSec: 30,
    recommendedOutputs: [{ capability: "video", engine: "veo", estimatedCostUsd: 2 }],
    bestRoiCombination: [], rationale: "",
  };
  return {
    loadAssets: async () => assets,
    classify: async () => classifications,
    score: async () => scores,
    strategy: async () => strategy,
    listingFacts: async () => ({ price: 1, beds: 1, baths: 1, city: "x", approved }),
    setStatus: async () => {},
    ...over,
  };
}

describe("runMediaAgent readiness gate", () => {
  it("suppresses video when the listing is not approved: no dispatch, reason recorded", async () => {
    const payload = await runMediaAgent({ jobId: "j", propertyId: "pr", ownerId: "o" }, makeDeps({}, false));
    expect(payload.mediaStrategy.recommendedOutputs).toHaveLength(0);
    expect(payload.providersUsed).toEqual({});
    const video = payload.readiness.find((r) => r.capability === "video");
    expect(video?.status).toBe("not_ready");
    expect(video?.reasons.map((x) => x.code)).toContain("listing_not_approved");
  });

  it("dispatches video when approved with an interior photo", async () => {
    const payload = await runMediaAgent({ jobId: "j", propertyId: "pr", ownerId: "o" }, makeDeps({}, true));
    expect(payload.mediaStrategy.recommendedOutputs.map((o) => o.capability)).toContain("video");
    expect(payload.readiness.find((r) => r.capability === "video")?.status).toBe("ready");
  });
});
```

Note: with a single interior photo, `video` is `ready` but `not_recommended`
(`few_interior_photos`). The orchestrator dispatches on `status === "ready"` (see Step 5), so
the second test passes; the `not_recommended` flag rides along in `payload.readiness` for the
UI. Keep dispatch keyed on `status`, not on `recommendation` — recommendation is advisory.

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/media-intelligence/agent.readiness.test.ts`
Expected: FAIL — `payload.readiness` is undefined and video is still dispatched when
unapproved.

- [ ] **Step 5: Evaluate readiness in the orchestrator**

In `agent.ts` add the import:

```ts
import { evaluateReadiness } from "@/lib/media-intelligence/readiness";
```

Immediately after `const mediaStrategy = await deps.strategy(...)` (line 55), insert:

```ts
  // Readiness gate — decide, per capability, what NOT to generate (deterministic, before spend).
  const readiness = evaluateReadiness(
    mediaStrategy.recommendedOutputs.map((o) => o.capability),
    { photoCount: assets.length, scores, classifications, listingApproved: facts.approved },
  );
  const producible = new Set(
    readiness.filter((r) => r.status === "ready").map((r) => r.capability),
  );
  mediaStrategy.recommendedOutputs = mediaStrategy.recommendedOutputs.filter((o) =>
    producible.has(o.capability),
  );
  log(jobId, "readiness", `ready: ${[...producible].join(",") || "none"}`);
```

Then add `readiness` to the returned `StrategyPayload` object (after `deliverables,`):

```ts
    deliverables,
    readiness,
    providersUsed,
```

(`planDeliverables(mediaStrategy)` on the next line already reads the filtered
`recommendedOutputs`, so a `not_ready` capability is never dispatched and no provider runs
for it.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/media-intelligence/agent.readiness.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Fix the existing strategy test for `approved`**

Run: `pnpm vitest run src/lib/media-intelligence/strategy.test.ts`. It now fails because
`ListingFacts` requires `approved`. Add `approved: true` to every `ListingFacts` literal in
`strategy.test.ts`. Re-run → PASS.

- [ ] **Step 8: Provide `approved` from the route**

Confirm the property-status value meaning "approved":

Run: `grep -rniE "status.*=.*'|pending_approval|listing_status|'active'|'approved'" src/app src/lib | grep -i status | head`

In `src/app/api/media-agent/generate/route.ts`, add `status` to the property select (line 69):

```ts
    .select("id, list_price, bedrooms, bathrooms, address_city, status")
```

In the `listingFacts` dep (lines 98-103) add the derived flag (use the confirmed value;
`"active"` is the expected published state):

```ts
    listingFacts: async (): Promise<ListingFacts> => ({
      price: Number(property.list_price ?? 0),
      beds: Number(property.bedrooms ?? 0),
      baths: Number(property.bathrooms ?? 0),
      city: String(property.address_city ?? ""),
      approved: String(property.status ?? "") === "active",
    }),
```

- [ ] **Step 9: Run all gates**

```bash
pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm migrations:check && pnpm build
```
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/lib/media-intelligence/types.ts src/lib/media-intelligence/strategy.ts src/lib/media-intelligence/strategy.test.ts src/lib/media-intelligence/agent.ts src/lib/media-intelligence/agent.readiness.test.ts src/app/api/media-agent/generate/route.ts
git commit -m "feat(media): readiness gate in the orchestrator — suppress before generation, persist per-capability readiness"
```

---

## Task 3: Surface readiness as actionable product guidance (panel + i18n, EN/ES)

**Files:**
- Modify: `src/lib/i18n.ts` (add a `mediaAgent.readiness` block in the `en` ~1158 and `es` ~2429 blocks)
- Create: `src/lib/media-intelligence/readiness-copy.ts` (map codes → localized template + interpolate params)
- Test: `src/lib/media-intelligence/readiness-copy.test.ts`
- Modify: `src/components/media-strategy-panel.tsx` (render readiness; states)
- Test: `src/lib/media-intelligence/i18n-parity.test.ts` (already enforces EN/ES parity — must stay green)

**Interfaces:**
- Consumes: `CapabilityReadiness`, `ReadinessReason`, `SuggestedAction`, the reason/action code
  enums (Task 1); `StrategyPayload.readiness` (Task 2); the `mediaAgent.readiness` dictionary.
- Produces: `resolveReasonText(reason, dict): string`, `resolveActionText(action, dict): string`.

- [ ] **Step 1: Add the localized copy (EN + ES) — one entry per code**

In `src/lib/i18n.ts`, add to the **en** `mediaAgent` block (after `tooFewPhotos`, line 1182):

```ts
      readiness: {
        recommendedTitle: "Recommended for this listing",
        notRecommendedTitle: "You could improve these first",
        notReadyTitle: "Not ready yet",
        stateAnalyzing: "Analyzing your photos…",
        stateEmpty: "Add photos to see what you can create.",
        stateError: "We couldn't analyze your photos. Please try again.",
        reason: {
          too_few_photos_for_tour: "Add at least {min} photos for a 3D tour (you have {have}).",
          listing_not_approved: "This unlocks once your listing is approved.",
          no_interior_photos: "Add interior photos to create a video.",
          few_interior_photos: "More interior photos make a stronger video ({have} of {want}).",
          low_photo_quality: "Your photos need to be a bit sharper and brighter for this.",
        },
        action: {
          add_more_photos: "Add photos",
          add_interior_photos: "Add interior photos",
          await_listing_approval: "Wait for approval",
          improve_photo_quality: "Improve photo quality",
        },
      },
```

Add the same structure to the **es** `mediaAgent` block with Spanish values:

```ts
      readiness: {
        recommendedTitle: "Recomendado para esta propiedad",
        notRecommendedTitle: "Podrías mejorar esto primero",
        notReadyTitle: "Aún no está listo",
        stateAnalyzing: "Analizando tus fotos…",
        stateEmpty: "Agrega fotos para ver qué puedes crear.",
        stateError: "No pudimos analizar tus fotos. Inténtalo de nuevo.",
        reason: {
          too_few_photos_for_tour: "Agrega al menos {min} fotos para un tour 3D (tienes {have}).",
          listing_not_approved: "Esto se habilita cuando tu propiedad esté aprobada.",
          no_interior_photos: "Agrega fotos de interiores para crear un video.",
          few_interior_photos: "Más fotos de interiores hacen un video más fuerte ({have} de {want}).",
          low_photo_quality: "Tus fotos necesitan un poco más de nitidez y luz para esto.",
        },
        action: {
          add_more_photos: "Agregar fotos",
          add_interior_photos: "Agregar fotos de interiores",
          await_listing_approval: "Esperar aprobación",
          improve_photo_quality: "Mejorar calidad de fotos",
        },
      },
```

- [ ] **Step 2: Write the failing copy-resolver test**

Create `src/lib/media-intelligence/readiness-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveReasonText, resolveActionText } from "@/lib/media-intelligence/readiness-copy";

const dict = {
  reason: {
    too_few_photos_for_tour: "Add at least {min} photos for a 3D tour (you have {have}).",
    listing_not_approved: "This unlocks once your listing is approved.",
    no_interior_photos: "Add interior photos to create a video.",
    few_interior_photos: "More interior photos make a stronger video ({have} of {want}).",
    low_photo_quality: "Your photos need to be a bit sharper and brighter for this.",
  },
  action: {
    add_more_photos: "Add photos",
    add_interior_photos: "Add interior photos",
    await_listing_approval: "Wait for approval",
    improve_photo_quality: "Improve photo quality",
  },
};

describe("resolveReasonText", () => {
  it("interpolates params into the localized template", () => {
    expect(resolveReasonText({ code: "too_few_photos_for_tour", params: { min: 8, have: 4 } }, dict))
      .toBe("Add at least 8 photos for a 3D tour (you have 4).");
  });
  it("returns the template as-is when there are no params", () => {
    expect(resolveReasonText({ code: "listing_not_approved" }, dict))
      .toBe("This unlocks once your listing is approved.");
  });
});

describe("resolveActionText", () => {
  it("resolves an action code", () => {
    expect(resolveActionText({ code: "add_interior_photos", params: { min: 3 } }, dict))
      .toBe("Add interior photos");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/media-intelligence/readiness-copy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the copy resolver**

Create `src/lib/media-intelligence/readiness-copy.ts`:

```ts
// Maps stable readiness reason/action codes to localized, param-interpolated text.
// Keeps internal codes out of the UI; the panel only ever renders resolved strings.
import type { ReadinessReason, SuggestedAction } from "@/lib/media-intelligence/types";

export interface ReadinessDict {
  reason: Record<string, string>;
  action: Record<string, string>;
}

function interpolate(template: string, params?: Record<string, number | string>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    params[key] === undefined ? `{${key}}` : String(params[key]),
  );
}

export function resolveReasonText(reason: ReadinessReason, dict: ReadinessDict): string {
  return interpolate(dict.reason[reason.code] ?? reason.code, reason.params);
}

export function resolveActionText(action: SuggestedAction, dict: ReadinessDict): string {
  return interpolate(dict.action[action.code] ?? action.code, action.params);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/media-intelligence/readiness-copy.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Verify EN/ES parity stays green**

Run: `pnpm vitest run src/lib/media-intelligence/i18n-parity.test.ts`
Expected: PASS. If it fails, the `en`/`es` `readiness` blocks are out of sync — align keys.

- [ ] **Step 7: Render readiness in the panel (read the file first)**

Open `src/components/media-strategy-panel.tsx`. It must receive `readiness: CapabilityReadiness[]`
(thread it from the dashboard's payload; the panel currently takes the strategy — add a
`readiness` prop and pass `payload.readiness`). Using the file's existing copy/`t` access and
`resolveReasonText`/`resolveActionText`, render three grouped, human sections — **never show
`status`, `recommendation`, capability enums, or the word "readiness" to the user**:

- **Recommended** (`status==="ready" && recommendation==="recommended"`): the capability as a
  friendly label (map `video→"Video"`, `tour→"3D tour"`, `image→"Virtual staging"`, etc.).
- **Could improve first** (`status==="ready" && recommendation==="not_recommended"`): friendly
  label + `resolveReasonText(reasons[0])` + a single primary `resolveActionText(suggestedActions[0])`.
- **Not ready yet** (`status==="not_ready"`): friendly label + reason(s) + one suggested action.

Cover the states: empty (`stateEmpty`), analyzing (`stateAnalyzing`), ready (the groups),
error (`stateError`). Keep it mobile-responsive with the file's existing layout utilities.
Behavior contract (required): guard each group on the filter above; present suppressed items
as an actionable suggestion, not an error.

- [ ] **Step 8: Run gates + visual check**

```bash
pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm build
```
Then verify the panel visually in EN and ES on a mobile viewport (use the `run` skill or the
dashboard for a real listing): the three groups render, copy is localized, no internal terms
appear.

- [ ] **Step 9: Commit**

```bash
git add src/lib/i18n.ts src/lib/media-intelligence/readiness-copy.ts src/lib/media-intelligence/readiness-copy.test.ts src/components/media-strategy-panel.tsx
git commit -m "feat(media): surface readiness as actionable product guidance (en/es, states)"
```

---

## Self-review

- **Spec coverage:** readiness ≠ entitlement/cost/provider (Global Constraints + Task 1 rules);
  per-capability (`evaluateReadiness` over a list, de-duped); status vs recommendation (two
  axes in `CapabilityReadiness`); structured multi-reason codes + params (Task 1 types/tests);
  API differentiates ready/recommended/suppressed via `payload.readiness` (Task 2); no provider
  runs when suppressed (Task 2 test asserts `providersUsed === {}`); LLM can't skip the gate
  (gate runs in the orchestrator, not in the LLM dep); UI actionable, localized, stateful, no
  internal terms (Task 3). All covered.
- **Placeholder scan:** the only non-literal steps are Task 2 Step 8 (confirm approved-status
  value — concrete grep) and Task 3 Step 7 (match panel markup — concrete behavior contract),
  neither a vague TODO.
- **Type consistency:** `CapabilityReadiness`, `ReadinessReason`, `SuggestedAction`,
  `ReadinessReasonCode`, `SuggestedActionCode`, `ReadinessContext`, `evaluateCapabilityReadiness`,
  `evaluateReadiness`, `StrategyPayload.readiness`, `ListingFacts.approved`, `resolveReasonText`,
  `resolveActionText` are used identically across Tasks 1-3.

---

## Stop after P1 — required close-out

Do **not** start P0-B (external) or P2. On finishing Task 3, deliver: commits created; files
modified; tests run + results; visual verification of the panel (EN/ES, mobile); the
suppressions/readiness implemented; any debt or decisions found; and an explicit confirmation
that **no merge, deploy, or infrastructure change occurred**.

## Deferred: P2 — gated on a formal render-target selection

Before P2, the next decision is **not** "install Remotion" but formally selecting the **render
execution target**, comparing: cost, max duration, cold starts, concurrency, storage,
observability, and Vercel compatibility. Options: Remotion Lambda (AWS), a container/worker
service, or a Vercel-compatible serverless render. P2 gets its own plan once that is chosen.
P3 (Veo/Luma) and P4 (Tour Engine) stay separate per the architecture + 3D specs.
