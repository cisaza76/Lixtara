# Media Intelligence Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 Media Intelligence Agent — a format-agnostic pipeline that analyzes a listing's real photos, produces a structured Media Strategy, and runs a mock-render job through a full state machine, behind a feature flag, with an extensible provider/specialist skeleton.

**Architecture:** Deterministic pipeline with LLM only at specific nodes (classify / quality / strategy). A `MediaGenerationProvider` hierarchy and a `MediaSpecialist` registry are defined as interfaces + a Mock implementation + stubs. Results persist as a versioned `jsonb` payload on a new `media_agent_jobs` table. A dashboard button triggers a synchronous route; a Server Component reads the result. v1 generates **no real media** — every deliverable is `mock`.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, `ai@6` + `@ai-sdk/anthropic@3` (`generateObject`, model `claude-sonnet-4-6`), `zod@4`, Supabase (`@supabase/ssr` + `@supabase/supabase-js`), Upstash rate limiting, Vitest.

## Global Constraints

- Product name is **Lixtara**; all new strings/identifiers use Lixtara (never Nexxos).
- **Never** create/alter/drop DB objects autonomously — migrations are authored here and applied by the owner via `supabase db push` after sign-off. This plan's migration task is **author-only**.
- No hardcoded pricing `199/495/995` — not relevant here, but provider cost estimates live in one module (`cost-table.ts`), never emitted by the LLM.
- Supabase clients: browser `@/lib/supabase/client`; server `@/lib/supabase/server`; service (secret key) via `createClient` from `@supabase/supabase-js` with `SUPABASE_SECRET_KEY` (mirror `serviceClient()` in `src/app/api/staging/generate/route.ts:35`).
- Env vars server-only, never `NEXT_PUBLIC` for secrets. New flag: `MEDIA_AGENT_ENABLED`.
- All new tables have RLS; personal data follows `owner_id = auth.uid()`.
- i18n: add every new key to **both** `en` and `es` in `src/lib/i18n.ts`.
- Quality gates before each commit that touches code: `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm migrations:check`, `pnpm build`.
- Tests: `import { describe, it, expect } from "vitest"`, `@/` alias, files `src/**/*.test.ts`, node env.
- Compliance: v1 renders nothing real; generation prompts carry `LIVING_LISTING_PROMPT`-style geometry guardrails; the Media Strategy may de-emphasize weak spaces but must never conceal material defects.
- Do **not** touch: `property_photos` schema, the 8-step listing wizard (`src/app/[lang]/listing/new/page.tsx`), `tour_jobs`, or existing staging/tour routes.

---

## File structure

```
src/lib/media-intelligence/
  types.ts                 # all core types + runtime constants + zod schemas
  cost-estimate.ts         # (see providers/cost-table.ts) — costs live under providers/
  ingest.ts                # load + validate property_photos → Asset[]
  classify.ts              # Claude Vision → Classification[] (injectable model call)
  quality.ts               # Claude Vision → QualityScore[] (+ deterministic CV extension point)
  select.ts                # PURE: Asset+Classification+Quality → SelectedShot[]
  strategy.ts              # Claude → MediaStrategy (cost filled from cost-table)
  prompts.ts               # PURE: SelectedShot[] → GenerationPrompt[]
  deliverables.ts          # PURE: MediaStrategy → planned Deliverable[]
  agent.ts                 # orchestrator: runMediaAgent(...) with injectable deps
  jobs.ts                  # persistence helpers over media_agent_jobs (injectable client)
  providers/
    types.ts               # MediaGenerationProvider + capability sub-interfaces + error
    cost-table.ts          # deterministic per-engine/per-capability cost estimates
    mock.ts                # MockProvider (all capabilities, placeholder output)
    veo.ts                 # VideoProvider adapter wrapping TourProcessor (registered; not-live in v1)
    stubs.ts               # Kling/Runway/Luma/Higgsfield/Wan + placeholder providers (throw NotConfigured)
    index.ts               # registry + selectProvider(capability, opts)
  agents/
    types.ts               # MediaSpecialist interface
    registry.ts            # register/get specialist by capability
    video-specialist.ts    # reference specialist (mock output in v1)
    stub-specialist.ts     # makeStubSpecialist(capability) factory
src/app/api/media-agent/generate/route.ts   # POST trigger
src/components/media-strategy-panel.tsx      # dashboard result panel (client)
supabase/migrations/<ts>_create_media_agent_jobs.sql   # author-only
```

Tests live beside their unit as `*.test.ts`.

---

## Task 1: Core types, constants & zod schemas

**Files:**
- Create: `src/lib/media-intelligence/types.ts`
- Test: `src/lib/media-intelligence/types.test.ts`

**Interfaces:**
- Produces: `MediaCapability`, `MEDIA_CAPABILITIES`, `MediaJobStatus`, `MEDIA_JOB_STATUSES`, `RoomType`, `ROOM_TYPES`, `Asset`, `Classification`, `QualityScore`, `SelectedShot`, `RecommendedOutput`, `MediaStrategy`, `mediaStrategyDraftSchema`, `MediaStrategyDraft`, `GenerationPrompt`, `Deliverable`, `StrategyPayload`, `STRATEGY_SCHEMA_VERSION`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/media-intelligence/types.test.ts
import { describe, it, expect } from "vitest";
import {
  MEDIA_CAPABILITIES,
  MEDIA_JOB_STATUSES,
  ROOM_TYPES,
  mediaStrategyDraftSchema,
  STRATEGY_SCHEMA_VERSION,
} from "@/lib/media-intelligence/types";

describe("media-intelligence types", () => {
  it("exposes the six capabilities and five job statuses", () => {
    expect(MEDIA_CAPABILITIES).toEqual([
      "video", "image", "presentation", "tour", "three_d", "voice",
    ]);
    expect(MEDIA_JOB_STATUSES).toEqual([
      "pending", "analyzing", "generating", "completed", "failed",
    ]);
  });

  it("includes core real-estate room types", () => {
    expect(ROOM_TYPES).toContain("fachada");
    expect(ROOM_TYPES).toContain("cocina");
    expect(ROOM_TYPES).toContain("aerea");
  });

  it("validates a well-formed strategy draft and rejects a bad one", () => {
    const ok = mediaStrategyDraftSchema.safeParse({
      targetAudience: "young families",
      buyerPersona: "first-time buyer",
      emotions: ["warmth"],
      highlightSpaces: ["cocina"],
      hideSpaces: [],
      narrativeOrder: ["fachada", "sala", "cocina"],
      visualStyle: "warm editorial",
      recommendedPlatforms: [{ platform: "instagram", rationale: "reach" }],
      recommendedDurationSec: 30,
      recommendedOutputs: [{ capability: "video", engine: "mock" }],
      bestRoiCombination: ["reel"],
      rationale: "because",
    });
    expect(ok.success).toBe(true);
    const bad = mediaStrategyDraftSchema.safeParse({ targetAudience: 123 });
    expect(bad.success).toBe(false);
  });

  it("pins the payload schema version", () => {
    expect(STRATEGY_SCHEMA_VERSION).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/media-intelligence/types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/media-intelligence/types.ts
// Core types for the Media Intelligence Agent. Format-agnostic by design:
// video is one MediaCapability among many. The LLM produces a "draft"
// strategy (no prices); deterministic code fills cost from the cost-table.
import { z } from "zod";

export const MEDIA_CAPABILITIES = [
  "video", "image", "presentation", "tour", "three_d", "voice",
] as const;
export type MediaCapability = (typeof MEDIA_CAPABILITIES)[number];

export const MEDIA_JOB_STATUSES = [
  "pending", "analyzing", "generating", "completed", "failed",
] as const;
export type MediaJobStatus = (typeof MEDIA_JOB_STATUSES)[number];

export const ROOM_TYPES = [
  "fachada", "sala", "cocina", "habitacion", "bano", "exterior",
  "amenity", "lote", "aerea", "plano", "render", "otro",
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export interface Asset {
  photoId: string;
  url: string;
  resolution?: { w: number; h: number };
}

export interface Classification {
  photoId: string;
  roomType: RoomType;
  tags: string[];
  confidence: number; // 0..1
}

export interface QualityScore {
  photoId: string;
  sharpness: number; // 0..1
  lighting: number; // 0..1
  framing: number; // 0..1
  overall: number; // 0..1
  duplicateOf?: string; // photoId of the better near-duplicate
}

export interface SelectedShot {
  photoId: string;
  order: number;
  roomType: RoomType;
  reason: string;
  suggestedMotion: string;
}

export interface RecommendedOutput {
  capability: MediaCapability;
  engine: string;
  estimatedCostUsd: number; // filled deterministically, NOT by the LLM
}

export interface MediaStrategy {
  targetAudience: string;
  buyerPersona: string;
  emotions: string[];
  highlightSpaces: string[];
  hideSpaces: string[];
  narrativeOrder: string[];
  visualStyle: string;
  recommendedPlatforms: Array<{ platform: string; rationale: string }>;
  recommendedDurationSec: number;
  recommendedOutputs: RecommendedOutput[];
  bestRoiCombination: string[];
  rationale: string;
}

// What the LLM returns: same shape MINUS estimatedCostUsd (deterministic later).
export const mediaStrategyDraftSchema = z.object({
  targetAudience: z.string(),
  buyerPersona: z.string(),
  emotions: z.array(z.string()),
  highlightSpaces: z.array(z.string()),
  hideSpaces: z.array(z.string()),
  narrativeOrder: z.array(z.string()),
  visualStyle: z.string(),
  recommendedPlatforms: z.array(
    z.object({ platform: z.string(), rationale: z.string() }),
  ),
  recommendedDurationSec: z.number(),
  recommendedOutputs: z.array(
    z.object({
      capability: z.enum(MEDIA_CAPABILITIES),
      engine: z.string(),
    }),
  ),
  bestRoiCombination: z.array(z.string()),
  rationale: z.string(),
});
export type MediaStrategyDraft = z.infer<typeof mediaStrategyDraftSchema>;

export interface GenerationPrompt {
  shotOrder: number;
  photoId: string;
  prompt: string;
  guardrails: string;
}

export interface Deliverable {
  id: string;
  capability: MediaCapability;
  kind: string; // e.g. "cinematic_horizontal", "vertical_reel", "teaser"
  aspect: string; // e.g. "16:9", "9:16", "1:1"
  platforms: string[];
  status: "planned" | "mock" | "approved";
  specialistId: string;
}

export const STRATEGY_SCHEMA_VERSION = 1 as const;

export interface StrategyPayload {
  schemaVersion: typeof STRATEGY_SCHEMA_VERSION;
  assets: Asset[];
  classifications: Classification[];
  scores: QualityScore[];
  selectedShots: SelectedShot[];
  mediaStrategy: MediaStrategy;
  generationPrompts: GenerationPrompt[];
  deliverables: Deliverable[];
  providersUsed: Partial<Record<MediaCapability, string>>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/media-intelligence/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-intelligence/types.ts src/lib/media-intelligence/types.test.ts
git commit -m "feat(media-agent): core types, constants, and strategy schema"
```

---

## Task 2: Provider cost table

**Files:**
- Create: `src/lib/media-intelligence/providers/cost-table.ts`
- Test: `src/lib/media-intelligence/providers/cost-table.test.ts`

**Interfaces:**
- Consumes: `MediaCapability` (Task 1).
- Produces: `PROVIDER_COST_USD`, `estimateCostUsd(engine: string, capability: MediaCapability): number`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/media-intelligence/providers/cost-table.test.ts
import { describe, it, expect } from "vitest";
import { estimateCostUsd } from "@/lib/media-intelligence/providers/cost-table";

describe("estimateCostUsd", () => {
  it("returns 0 for the mock engine", () => {
    expect(estimateCostUsd("mock", "video")).toBe(0);
  });
  it("returns a positive estimate for a known live engine/capability", () => {
    expect(estimateCostUsd("veo", "video")).toBeGreaterThan(0);
  });
  it("returns 0 for an unknown engine or unsupported capability", () => {
    expect(estimateCostUsd("nope", "video")).toBe(0);
    expect(estimateCostUsd("veo", "voice")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/media-intelligence/providers/cost-table.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/media-intelligence/providers/cost-table.ts
// Deterministic, per-engine/per-capability cost estimates (USD, rough
// per-deliverable). These are PLACEHOLDER estimates for the strategy's
// budgeting — the single source of truth for any price shown in the UI.
// The LLM must never emit prices; it only recommends an engine.
import type { MediaCapability } from "@/lib/media-intelligence/types";

export const PROVIDER_COST_USD: Record<
  string,
  Partial<Record<MediaCapability, number>>
> = {
  mock: { video: 0, image: 0, presentation: 0, tour: 0, three_d: 0, voice: 0 },
  veo: { video: 0.4 },
  kling: { video: 0.28 },
  runway: { video: 0.5 },
  luma: { video: 0.35, image: 0.02 },
  higgsfield: { video: 0.45 },
  wan: { video: 0.2 },
};

export function estimateCostUsd(
  engine: string,
  capability: MediaCapability,
): number {
  return PROVIDER_COST_USD[engine]?.[capability] ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/media-intelligence/providers/cost-table.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-intelligence/providers/cost-table.ts src/lib/media-intelligence/providers/cost-table.test.ts
git commit -m "feat(media-agent): deterministic provider cost table"
```

---

## Task 3: Provider interfaces + Mock provider

**Files:**
- Create: `src/lib/media-intelligence/providers/types.ts`, `src/lib/media-intelligence/providers/mock.ts`
- Test: `src/lib/media-intelligence/providers/mock.test.ts`

**Interfaces:**
- Consumes: `MediaCapability`, `MediaStrategy`, `SelectedShot`, `GenerationPrompt`, `Deliverable` (Task 1).
- Produces: `MediaGenInput`, `GeneratedDeliverable`, `MediaGenerationProvider`, `VideoProvider`, `ImageProvider`, `PresentationProvider`, `TourProvider`, `ThreeDProvider`, `VoiceProvider`, `ProviderNotConfiguredError`, `MockProvider`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/media-intelligence/providers/mock.test.ts
import { describe, it, expect } from "vitest";
import { MockProvider } from "@/lib/media-intelligence/providers/mock";
import type { MediaGenInput } from "@/lib/media-intelligence/providers/types";
import { MEDIA_CAPABILITIES } from "@/lib/media-intelligence/types";

function input(capability: (typeof MEDIA_CAPABILITIES)[number]): MediaGenInput {
  return {
    capability,
    strategy: {} as never,
    shots: [],
    prompts: [],
    deliverable: {
      id: "d1", capability, kind: "x", aspect: "16:9",
      platforms: [], status: "planned", specialistId: "s1",
    },
  };
}

describe("MockProvider", () => {
  const p = new MockProvider();
  it("is always configured and covers every capability", () => {
    expect(p.isConfigured()).toBe(true);
    for (const c of MEDIA_CAPABILITIES) expect(p.capabilities).toContain(c);
  });
  it("returns a mock deliverable with no real url", async () => {
    const r = await p.generate(input("video"));
    expect(r.status).toBe("mock");
    expect(r.url).toBeNull();
    expect(r.provider).toBe("mock");
    expect(r.deliverableId).toBe("d1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/media-intelligence/providers/mock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementations**

```ts
// src/lib/media-intelligence/providers/types.ts
// The MediaGenerationProvider is the deliverable-level engine seam that
// specialists talk to. Capability sub-interfaces are structurally identical
// in v1 — they exist as explicit extension points for future engines.
import type {
  Deliverable,
  GenerationPrompt,
  MediaCapability,
  MediaStrategy,
  SelectedShot,
} from "@/lib/media-intelligence/types";

export interface MediaGenInput {
  capability: MediaCapability;
  strategy: MediaStrategy;
  shots: SelectedShot[];
  prompts: GenerationPrompt[];
  deliverable: Deliverable;
}

export interface GeneratedDeliverable {
  deliverableId: string;
  url: string | null; // null in mock — nothing real is produced in v1
  status: "mock" | "ready" | "failed";
  provider: string;
  detail?: string;
}

export interface MediaGenerationProvider {
  readonly id: string;
  readonly capabilities: readonly MediaCapability[];
  isConfigured(): boolean;
  generate(input: MediaGenInput): Promise<GeneratedDeliverable>;
}

// Capability-scoped extension seams (structurally identical in v1).
export type VideoProvider = MediaGenerationProvider;
export type ImageProvider = MediaGenerationProvider;
export type PresentationProvider = MediaGenerationProvider;
export type TourProvider = MediaGenerationProvider;
export type ThreeDProvider = MediaGenerationProvider;
export type VoiceProvider = MediaGenerationProvider;

export class ProviderNotConfiguredError extends Error {
  constructor(providerId: string, detail?: string) {
    super(`provider "${providerId}" is not configured${detail ? `: ${detail}` : ""}`);
    this.name = "ProviderNotConfiguredError";
  }
}
```

```ts
// src/lib/media-intelligence/providers/mock.ts
// Always-available provider that stands in for real generation in v1.
// Produces a "mock" deliverable (no url) so the whole pipeline runs end-to-end
// with zero external spend and zero misrepresentation risk.
import { MEDIA_CAPABILITIES } from "@/lib/media-intelligence/types";
import type {
  GeneratedDeliverable,
  MediaGenInput,
  MediaGenerationProvider,
} from "@/lib/media-intelligence/providers/types";

export class MockProvider implements MediaGenerationProvider {
  readonly id = "mock";
  readonly capabilities = MEDIA_CAPABILITIES;
  isConfigured(): boolean {
    return true;
  }
  async generate(input: MediaGenInput): Promise<GeneratedDeliverable> {
    return {
      deliverableId: input.deliverable.id,
      url: null,
      status: "mock",
      provider: this.id,
      detail: "mock render — real generation lands in a later slice",
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/media-intelligence/providers/mock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-intelligence/providers/types.ts src/lib/media-intelligence/providers/mock.ts src/lib/media-intelligence/providers/mock.test.ts
git commit -m "feat(media-agent): MediaGenerationProvider interfaces + MockProvider"
```

---

## Task 4: Stub providers + Veo adapter

**Files:**
- Create: `src/lib/media-intelligence/providers/stubs.ts`, `src/lib/media-intelligence/providers/veo.ts`
- Test: `src/lib/media-intelligence/providers/stubs.test.ts`

**Interfaces:**
- Consumes: `MediaGenerationProvider`, `ProviderNotConfiguredError`, `MediaGenInput` (Task 3).
- Produces: `KlingProvider`, `RunwayProvider`, `LumaVideoProvider`, `HiggsfieldProvider`, `WanProvider`, `PLACEHOLDER_PROVIDERS`, `VeoVideoProvider`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/media-intelligence/providers/stubs.test.ts
import { describe, it, expect } from "vitest";
import { KlingProvider, WanProvider } from "@/lib/media-intelligence/providers/stubs";
import { VeoVideoProvider } from "@/lib/media-intelligence/providers/veo";
import { ProviderNotConfiguredError } from "@/lib/media-intelligence/providers/types";
import type { MediaGenInput } from "@/lib/media-intelligence/providers/types";

const input: MediaGenInput = {
  capability: "video",
  strategy: {} as never,
  shots: [],
  prompts: [],
  deliverable: {
    id: "d", capability: "video", kind: "x", aspect: "16:9",
    platforms: [], status: "planned", specialistId: "s",
  },
};

describe("stub providers", () => {
  it("are reported unconfigured and throw on generate", async () => {
    const p = new KlingProvider();
    expect(p.isConfigured()).toBe(false);
    await expect(p.generate(input)).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    await expect(new WanProvider().generate(input)).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
  it("Veo adapter is video-only and not live in v1", async () => {
    const v = new VeoVideoProvider();
    expect(v.capabilities).toEqual(["video"]);
    await expect(v.generate(input)).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/media-intelligence/providers/stubs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementations**

```ts
// src/lib/media-intelligence/providers/stubs.ts
// Not-yet-configured engine adapters. They advertise their capability so the
// registry knows they exist, but throw until their slice wires the real API.
import type { MediaCapability } from "@/lib/media-intelligence/types";
import {
  ProviderNotConfiguredError,
  type GeneratedDeliverable,
  type MediaGenInput,
  type MediaGenerationProvider,
} from "@/lib/media-intelligence/providers/types";

class NotConfiguredProvider implements MediaGenerationProvider {
  constructor(
    readonly id: string,
    readonly capabilities: readonly MediaCapability[],
  ) {}
  isConfigured(): boolean {
    return false;
  }
  async generate(_input: MediaGenInput): Promise<GeneratedDeliverable> {
    throw new ProviderNotConfiguredError(this.id);
  }
}

export class KlingProvider extends NotConfiguredProvider {
  constructor() { super("kling", ["video"]); }
}
export class RunwayProvider extends NotConfiguredProvider {
  constructor() { super("runway", ["video"]); }
}
export class LumaVideoProvider extends NotConfiguredProvider {
  constructor() { super("luma", ["video", "image"]); }
}
export class HiggsfieldProvider extends NotConfiguredProvider {
  constructor() { super("higgsfield", ["video"]); }
}
export class WanProvider extends NotConfiguredProvider {
  constructor() { super("wan", ["video"]); }
}

// Placeholder providers for capabilities with no engine yet.
export const PLACEHOLDER_PROVIDERS: MediaGenerationProvider[] = [
  new NotConfiguredProvider("placeholder-image", ["image"]),
  new NotConfiguredProvider("placeholder-presentation", ["presentation"]),
  new NotConfiguredProvider("placeholder-tour", ["tour"]),
  new NotConfiguredProvider("placeholder-3d", ["three_d"]),
  new NotConfiguredProvider("placeholder-voice", ["voice"]),
];
```

```ts
// src/lib/media-intelligence/providers/veo.ts
// Adapter that will delegate real video generation to the existing
// TourProcessor/Veo engine (src/lib/tour/). Registered so selectProvider() can
// find it, but NOT live in v1 — real generation lands in slice C. Kept honest:
// it throws rather than pretending to produce a video.
import {
  ProviderNotConfiguredError,
  type GeneratedDeliverable,
  type MediaGenInput,
  type VideoProvider,
} from "@/lib/media-intelligence/providers/types";
import type { MediaCapability } from "@/lib/media-intelligence/types";

export class VeoVideoProvider implements VideoProvider {
  readonly id = "veo";
  readonly capabilities: readonly MediaCapability[] = ["video"];
  isConfigured(): boolean {
    // A real GEMINI_API_KEY is necessary but not sufficient — the composition
    // path (slice C) isn't built yet, so treat as not-live in v1.
    return false;
  }
  async generate(_input: MediaGenInput): Promise<GeneratedDeliverable> {
    throw new ProviderNotConfiguredError(
      this.id,
      "Veo composition path lands in the generation slice (C)",
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/media-intelligence/providers/stubs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-intelligence/providers/stubs.ts src/lib/media-intelligence/providers/veo.ts src/lib/media-intelligence/providers/stubs.test.ts
git commit -m "feat(media-agent): stub video providers + Veo adapter seam"
```

---

## Task 5: Provider registry + selection

**Files:**
- Create: `src/lib/media-intelligence/providers/index.ts`
- Test: `src/lib/media-intelligence/providers/index.test.ts`

**Interfaces:**
- Consumes: all provider classes (Tasks 3–4).
- Produces: `PROVIDER_REGISTRY`, `selectProvider(capability: MediaCapability, opts?: { allowLive?: boolean }): MediaGenerationProvider`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/media-intelligence/providers/index.test.ts
import { describe, it, expect } from "vitest";
import { selectProvider } from "@/lib/media-intelligence/providers";

describe("selectProvider", () => {
  it("falls back to mock when no live provider is allowed", () => {
    expect(selectProvider("video").id).toBe("mock");
    expect(selectProvider("voice").id).toBe("mock");
  });
  it("still returns mock when allowLive but nothing is configured (v1)", () => {
    expect(selectProvider("video", { allowLive: true }).id).toBe("mock");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/media-intelligence/providers/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/media-intelligence/providers/index.ts
// Provider registry + capability-based selection. In v1 nothing live is
// configured, so selectProvider always resolves to MockProvider.
import type { MediaCapability } from "@/lib/media-intelligence/types";
import type { MediaGenerationProvider } from "@/lib/media-intelligence/providers/types";
import { MockProvider } from "@/lib/media-intelligence/providers/mock";
import { VeoVideoProvider } from "@/lib/media-intelligence/providers/veo";
import {
  KlingProvider,
  RunwayProvider,
  LumaVideoProvider,
  HiggsfieldProvider,
  WanProvider,
  PLACEHOLDER_PROVIDERS,
} from "@/lib/media-intelligence/providers/stubs";

const MOCK = new MockProvider();

export const PROVIDER_REGISTRY: MediaGenerationProvider[] = [
  MOCK,
  new VeoVideoProvider(),
  new KlingProvider(),
  new RunwayProvider(),
  new LumaVideoProvider(),
  new HiggsfieldProvider(),
  new WanProvider(),
  ...PLACEHOLDER_PROVIDERS,
];

export function selectProvider(
  capability: MediaCapability,
  opts: { allowLive?: boolean } = {},
): MediaGenerationProvider {
  if (opts.allowLive) {
    const live = PROVIDER_REGISTRY.find(
      (p) => p.id !== "mock" && p.capabilities.includes(capability) && p.isConfigured(),
    );
    if (live) return live;
  }
  return MOCK;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/media-intelligence/providers/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-intelligence/providers/index.ts src/lib/media-intelligence/providers/index.test.ts
git commit -m "feat(media-agent): provider registry + capability selection"
```

---

## Task 6: Specialist interface, registry & specialists

**Files:**
- Create: `src/lib/media-intelligence/agents/types.ts`, `.../agents/registry.ts`, `.../agents/video-specialist.ts`, `.../agents/stub-specialist.ts`
- Test: `src/lib/media-intelligence/agents/registry.test.ts`

**Interfaces:**
- Consumes: `MediaStrategy`, `Deliverable`, `MediaCapability` (Task 1); `MediaGenerationProvider`, `GeneratedDeliverable` (Task 3).
- Produces: `MediaSpecialist`, `getSpecialist(capability): MediaSpecialist`, `SPECIALISTS`, `VideoSpecialist`, `makeStubSpecialist(capability): MediaSpecialist`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/media-intelligence/agents/registry.test.ts
import { describe, it, expect } from "vitest";
import { getSpecialist } from "@/lib/media-intelligence/agents/registry";
import { MockProvider } from "@/lib/media-intelligence/providers/mock";
import type { MediaStrategy } from "@/lib/media-intelligence/types";

const strategy: MediaStrategy = {
  targetAudience: "a", buyerPersona: "b", emotions: [],
  highlightSpaces: [], hideSpaces: [], narrativeOrder: [],
  visualStyle: "s", recommendedPlatforms: [], recommendedDurationSec: 30,
  recommendedOutputs: [
    { capability: "video", engine: "mock", estimatedCostUsd: 0 },
    { capability: "image", engine: "mock", estimatedCostUsd: 0 },
  ],
  bestRoiCombination: [], rationale: "r",
};

describe("specialist registry", () => {
  it("returns a specialist per capability that plans + executes via a provider", async () => {
    const video = getSpecialist("video");
    expect(video.capability).toBe("video");
    const deliverables = video.plan(strategy);
    expect(deliverables.length).toBeGreaterThan(0);
    expect(deliverables[0].capability).toBe("video");
    const result = await video.execute(deliverables[0], new MockProvider());
    expect(result.status).toBe("mock");
  });
  it("provides a stub specialist for non-video capabilities", () => {
    expect(getSpecialist("voice").capability).toBe("voice");
    expect(getSpecialist("presentation").plan(strategy)).toBeInstanceOf(Array);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/media-intelligence/agents/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementations**

```ts
// src/lib/media-intelligence/agents/types.ts
// A MediaSpecialist turns the Media Strategy into concrete deliverables for its
// capability and executes them via a provider. Specialists do NOT re-decide
// strategy — they execute the plan the Media Intelligence Agent produced.
import type {
  Deliverable,
  MediaCapability,
  MediaStrategy,
} from "@/lib/media-intelligence/types";
import type {
  GeneratedDeliverable,
  MediaGenerationProvider,
} from "@/lib/media-intelligence/providers/types";

export interface MediaSpecialist {
  readonly id: string;
  readonly capability: MediaCapability;
  plan(strategy: MediaStrategy): Deliverable[];
  execute(
    deliverable: Deliverable,
    provider: MediaGenerationProvider,
  ): Promise<GeneratedDeliverable>;
}
```

```ts
// src/lib/media-intelligence/agents/video-specialist.ts
// Reference specialist. Plans video deliverables from the strategy's
// recommended video outputs and executes them via the selected provider
// (MockProvider in v1).
import type { Deliverable, MediaStrategy } from "@/lib/media-intelligence/types";
import type {
  GeneratedDeliverable,
  MediaGenerationProvider,
} from "@/lib/media-intelligence/providers/types";
import type { MediaSpecialist } from "@/lib/media-intelligence/agents/types";

// The concrete video formats v1 plans. Deterministic — not model-driven.
const VIDEO_FORMATS: Array<Pick<Deliverable, "kind" | "aspect" | "platforms">> = [
  { kind: "cinematic_horizontal", aspect: "16:9", platforms: ["web", "youtube"] },
  { kind: "vertical_reel", aspect: "9:16", platforms: ["instagram", "tiktok"] },
  { kind: "teaser", aspect: "1:1", platforms: ["instagram", "facebook"] },
];

export class VideoSpecialist implements MediaSpecialist {
  readonly id = "video-specialist";
  readonly capability = "video" as const;

  plan(strategy: MediaStrategy): Deliverable[] {
    const wantsVideo = strategy.recommendedOutputs.some(
      (o) => o.capability === "video",
    );
    if (!wantsVideo) return [];
    return VIDEO_FORMATS.map((f) => ({
      id: `video-${f.kind}`,
      capability: "video" as const,
      kind: f.kind,
      aspect: f.aspect,
      platforms: f.platforms,
      status: "planned" as const,
      specialistId: this.id,
    }));
  }

  async execute(
    deliverable: Deliverable,
    provider: MediaGenerationProvider,
  ): Promise<GeneratedDeliverable> {
    return provider.generate({
      capability: this.capability,
      strategy: {} as never, // strategy not needed by the mock; real providers get it via agent
      shots: [],
      prompts: [],
      deliverable,
    });
  }
}
```

```ts
// src/lib/media-intelligence/agents/stub-specialist.ts
// Factory for capabilities without a bespoke specialist yet. Plans one planned
// deliverable per recommended output of its capability; executes via provider
// (mock in v1). Never throws.
import type {
  Deliverable,
  MediaCapability,
  MediaStrategy,
} from "@/lib/media-intelligence/types";
import type {
  GeneratedDeliverable,
  MediaGenerationProvider,
} from "@/lib/media-intelligence/providers/types";
import type { MediaSpecialist } from "@/lib/media-intelligence/agents/types";

export function makeStubSpecialist(capability: MediaCapability): MediaSpecialist {
  return {
    id: `${capability}-specialist-stub`,
    capability,
    plan(strategy: MediaStrategy): Deliverable[] {
      return strategy.recommendedOutputs
        .filter((o) => o.capability === capability)
        .map((_o, i) => ({
          id: `${capability}-${i}`,
          capability,
          kind: `${capability}_default`,
          aspect: "n/a",
          platforms: [],
          status: "planned" as const,
          specialistId: `${capability}-specialist-stub`,
        }));
    },
    async execute(
      deliverable: Deliverable,
      provider: MediaGenerationProvider,
    ): Promise<GeneratedDeliverable> {
      return provider.generate({
        capability,
        strategy: {} as never,
        shots: [],
        prompts: [],
        deliverable,
      });
    },
  };
}
```

```ts
// src/lib/media-intelligence/agents/registry.ts
import type { MediaCapability } from "@/lib/media-intelligence/types";
import type { MediaSpecialist } from "@/lib/media-intelligence/agents/types";
import { VideoSpecialist } from "@/lib/media-intelligence/agents/video-specialist";
import { makeStubSpecialist } from "@/lib/media-intelligence/agents/stub-specialist";

export const SPECIALISTS: Record<MediaCapability, MediaSpecialist> = {
  video: new VideoSpecialist(),
  image: makeStubSpecialist("image"),
  presentation: makeStubSpecialist("presentation"),
  tour: makeStubSpecialist("tour"),
  three_d: makeStubSpecialist("three_d"),
  voice: makeStubSpecialist("voice"),
};

export function getSpecialist(capability: MediaCapability): MediaSpecialist {
  return SPECIALISTS[capability];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/media-intelligence/agents/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-intelligence/agents/
git commit -m "feat(media-agent): specialist interface, registry, video + stub specialists"
```

---

## Task 7: Persistence migration (author-only) + jobs helper

**Files:**
- Create: `supabase/migrations/<14-digit-ts>_create_media_agent_jobs.sql` (author only — owner applies)
- Create: `src/lib/media-intelligence/jobs.ts`
- Test: `src/lib/media-intelligence/jobs.test.ts`

**Interfaces:**
- Consumes: `StrategyPayload`, `MediaJobStatus` (Task 1).
- Produces: `JobDbClient` (structural), `createJob`, `setJobStatus`, `completeJob`, `failJob`, `getLatestJobForProperty`.

- [ ] **Step 1: Create the migration file (author only)**

Run: `supabase migration new create_media_agent_jobs`
Then fill the generated file with:

```sql
-- media_agent_jobs: one row per Media Intelligence Agent run for a listing.
-- The full analysis + strategy live in the versioned `strategy` jsonb payload.
-- No columns are added to property_photos; per-photo analysis is keyed by
-- photoId inside the payload. RLS: owner-only (owner_id = auth.uid()).
create table public.media_agent_jobs (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending','analyzing','generating','completed','failed')),
  strategy     jsonb,
  providers    text,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index media_agent_jobs_property_idx on public.media_agent_jobs (property_id);
create index media_agent_jobs_owner_idx    on public.media_agent_jobs (owner_id);

alter table public.media_agent_jobs enable row level security;

create policy "media_agent_jobs owner select" on public.media_agent_jobs
  for select using (owner_id = auth.uid());
create policy "media_agent_jobs owner insert" on public.media_agent_jobs
  for insert with check (owner_id = auth.uid());
create policy "media_agent_jobs owner update" on public.media_agent_jobs
  for update using (owner_id = auth.uid());
```

- [ ] **Step 2: Validate the migration filename (no DB write)**

Run: `pnpm migrations:check`
Expected: PASS (filename is `<14-digit-ts>_create_media_agent_jobs.sql`, version unique).

> **DO NOT run `supabase db push`.** The owner applies this after sign-off.

- [ ] **Step 3: Write the failing test for the jobs helper**

```ts
// src/lib/media-intelligence/jobs.test.ts
import { describe, it, expect, vi } from "vitest";
import { createJob, setJobStatus, completeJob, failJob } from "@/lib/media-intelligence/jobs";

// Minimal fake of the supabase query-builder chain we use.
function fakeClient() {
  const calls: Record<string, unknown> = {};
  const builder = {
    insert: vi.fn(() => builder),
    update: vi.fn((patch: unknown) => { calls.update = patch; return builder; }),
    eq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn(async () => ({ data: { id: "job-1" }, error: null })),
  };
  return {
    calls,
    from: vi.fn(() => builder),
    builder,
  };
}

describe("jobs persistence", () => {
  it("createJob inserts a pending row and returns the id", async () => {
    const c = fakeClient();
    const id = await createJob(c as never, { propertyId: "p1", ownerId: "o1" });
    expect(id).toBe("job-1");
    expect(c.builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ property_id: "p1", owner_id: "o1", status: "pending" }),
    );
  });
  it("setJobStatus writes status + updated_at", async () => {
    const c = fakeClient();
    await setJobStatus(c as never, "job-1", "analyzing");
    expect(c.calls.update).toMatchObject({ status: "analyzing" });
  });
  it("failJob writes failed + error", async () => {
    const c = fakeClient();
    await failJob(c as never, "job-1", "boom");
    expect(c.calls.update).toMatchObject({ status: "failed", error: "boom" });
  });
  it("completeJob writes completed + strategy + providers", async () => {
    const c = fakeClient();
    await completeJob(c as never, "job-1", { schemaVersion: 1 } as never, "mock");
    expect(c.calls.update).toMatchObject({ status: "completed", providers: "mock" });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test src/lib/media-intelligence/jobs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Write the implementation**

```ts
// src/lib/media-intelligence/jobs.ts
// Persistence helpers over media_agent_jobs. The caller passes a supabase
// client (service client from the route). Structural JobDbClient keeps these
// unit-testable with a fake.
import type { MediaJobStatus, StrategyPayload } from "@/lib/media-intelligence/types";

// Structural subset of the supabase client we rely on.
export interface JobDbClient {
  from(table: string): {
    insert(row: unknown): {
      select(cols?: string): { single(): Promise<{ data: { id: string } | null; error: unknown }> };
    };
    update(patch: unknown): { eq(col: string, val: string): Promise<{ error: unknown }> };
    select(cols?: string): {
      eq(col: string, val: string): {
        order(col: string, opts: { ascending: boolean }): {
          limit(n: number): {
            maybeSingle(): Promise<{ data: unknown; error: unknown }>;
          };
        };
      };
    };
  };
}

const TABLE = "media_agent_jobs";

export async function createJob(
  db: JobDbClient,
  input: { propertyId: string; ownerId: string },
): Promise<string> {
  const { data, error } = await db
    .from(TABLE)
    .insert({
      property_id: input.propertyId,
      owner_id: input.ownerId,
      status: "pending" as MediaJobStatus,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("media_agent_jobs insert failed");
  return data.id;
}

export async function setJobStatus(
  db: JobDbClient,
  jobId: string,
  status: MediaJobStatus,
): Promise<void> {
  await db
    .from(TABLE)
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

export async function completeJob(
  db: JobDbClient,
  jobId: string,
  payload: StrategyPayload,
  providers: string,
): Promise<void> {
  await db
    .from(TABLE)
    .update({
      status: "completed" as MediaJobStatus,
      strategy: payload,
      providers,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

export async function failJob(
  db: JobDbClient,
  jobId: string,
  error: string,
): Promise<void> {
  await db
    .from(TABLE)
    .update({
      status: "failed" as MediaJobStatus,
      error,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test src/lib/media-intelligence/jobs.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/*_create_media_agent_jobs.sql src/lib/media-intelligence/jobs.ts src/lib/media-intelligence/jobs.test.ts
git commit -m "feat(media-agent): media_agent_jobs migration (author-only) + jobs persistence"
```

---

## Task 8: `select.ts` — pure hero-shot selection

**Files:**
- Create: `src/lib/media-intelligence/select.ts`
- Test: `src/lib/media-intelligence/select.test.ts`

**Interfaces:**
- Consumes: `Asset`, `Classification`, `QualityScore`, `SelectedShot`, `RoomType` (Task 1).
- Produces: `NARRATIVE_ORDER`, `selectHeroShots(assets, classifications, scores, opts?): SelectedShot[]`, `SelectionEmptyError`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/media-intelligence/select.test.ts
import { describe, it, expect } from "vitest";
import { selectHeroShots, SelectionEmptyError } from "@/lib/media-intelligence/select";
import type { Asset, Classification, QualityScore } from "@/lib/media-intelligence/types";

const asset = (id: string): Asset => ({ photoId: id, url: `http://x/${id}` });
const cls = (id: string, roomType: Classification["roomType"]): Classification =>
  ({ photoId: id, roomType, tags: [], confidence: 0.9 });
const q = (id: string, overall: number, dup?: string): QualityScore =>
  ({ photoId: id, sharpness: overall, lighting: overall, framing: overall, overall, duplicateOf: dup });

describe("selectHeroShots", () => {
  it("orders shots by real-estate narrative and keeps one best per room", () => {
    const assets = [asset("a"), asset("b"), asset("c"), asset("d")];
    const classes = [cls("a", "cocina"), cls("b", "fachada"), cls("c", "cocina"), cls("d", "sala")];
    const scores = [q("a", 0.6), q("b", 0.9), q("c", 0.8), q("d", 0.7)];
    const out = selectHeroShots(assets, classes, scores);
    // fachada first, then sala, then cocina (best of a/c = c)
    expect(out.map((s) => s.roomType)).toEqual(["fachada", "sala", "cocina"]);
    expect(out.find((s) => s.roomType === "cocina")!.photoId).toBe("c");
    out.forEach((s, i) => expect(s.order).toBe(i));
  });

  it("drops duplicates and low-quality shots", () => {
    const assets = [asset("a"), asset("b")];
    const classes = [cls("a", "sala"), cls("b", "bano")];
    const scores = [q("a", 0.8), q("b", 0.1, "a")]; // b is a dupe + low quality
    const out = selectHeroShots(assets, classes, scores);
    expect(out.map((s) => s.photoId)).toEqual(["a"]);
  });

  it("throws SelectionEmptyError when nothing survives", () => {
    const assets = [asset("a")];
    const classes = [cls("a", "sala")];
    const scores = [q("a", 0.05)];
    expect(() => selectHeroShots(assets, classes, scores)).toThrow(SelectionEmptyError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/media-intelligence/select.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/media-intelligence/select.ts
// PURE hero-shot selection. Deterministic and fully unit-testable — this is the
// "orchestration" intelligence: narrative order + one-best-per-room + drop
// low-quality and duplicates.
import type {
  Asset,
  Classification,
  QualityScore,
  RoomType,
  SelectedShot,
} from "@/lib/media-intelligence/types";

// Real-estate storytelling order. Rooms not listed sort last (stable).
export const NARRATIVE_ORDER: RoomType[] = [
  "fachada", "exterior", "sala", "cocina", "habitacion", "bano",
  "amenity", "lote", "aerea", "plano", "render", "otro",
];

const MIN_QUALITY = 0.25; // below this a shot is not usable

export class SelectionEmptyError extends Error {
  constructor() {
    super("no usable photos survived selection");
    this.name = "SelectionEmptyError";
  }
}

const MOTION_BY_ROOM: Partial<Record<RoomType, string>> = {
  fachada: "slow push-in on the entrance",
  sala: "gentle dolly across the living space",
  cocina: "smooth pan along the counters",
  aerea: "slow reveal of the lot",
};

export function selectHeroShots(
  assets: Asset[],
  classifications: Classification[],
  scores: QualityScore[],
  opts: { cap?: number } = {},
): SelectedShot[] {
  const cap = opts.cap ?? 12;
  const clsById = new Map(classifications.map((c) => [c.photoId, c]));
  const scoreById = new Map(scores.map((s) => [s.photoId, s]));

  // Keep usable, non-duplicate assets.
  const usable = assets.filter((a) => {
    const s = scoreById.get(a.photoId);
    if (!s) return false;
    if (s.duplicateOf) return false;
    return s.overall >= MIN_QUALITY;
  });

  // One best-quality shot per room type.
  const bestPerRoom = new Map<RoomType, { photoId: string; overall: number }>();
  for (const a of usable) {
    const cls = clsById.get(a.photoId);
    const s = scoreById.get(a.photoId);
    if (!cls || !s) continue;
    const cur = bestPerRoom.get(cls.roomType);
    if (!cur || s.overall > cur.overall) {
      bestPerRoom.set(cls.roomType, { photoId: a.photoId, overall: s.overall });
    }
  }

  if (bestPerRoom.size === 0) throw new SelectionEmptyError();

  // Emit in narrative order.
  const shots: SelectedShot[] = [];
  let order = 0;
  for (const room of NARRATIVE_ORDER) {
    const pick = bestPerRoom.get(room);
    if (!pick) continue;
    shots.push({
      photoId: pick.photoId,
      order: order++,
      roomType: room,
      reason: `best ${room} shot (quality ${pick.overall.toFixed(2)})`,
      suggestedMotion: MOTION_BY_ROOM[room] ?? "subtle push-in",
    });
    if (shots.length >= cap) break;
  }
  return shots;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/media-intelligence/select.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-intelligence/select.ts src/lib/media-intelligence/select.test.ts
git commit -m "feat(media-agent): pure hero-shot selection"
```

---

## Task 9: `prompts.ts` — per-shot generation prompts with guardrails

**Files:**
- Create: `src/lib/media-intelligence/prompts.ts`
- Test: `src/lib/media-intelligence/prompts.test.ts`

**Interfaces:**
- Consumes: `SelectedShot`, `GenerationPrompt`, `MediaStrategy` (Task 1).
- Produces: `GEOMETRY_GUARDRAILS`, `buildGenerationPrompts(shots, strategy): GenerationPrompt[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/media-intelligence/prompts.test.ts
import { describe, it, expect } from "vitest";
import { buildGenerationPrompts, GEOMETRY_GUARDRAILS } from "@/lib/media-intelligence/prompts";
import type { MediaStrategy, SelectedShot } from "@/lib/media-intelligence/types";

const strategy: MediaStrategy = {
  targetAudience: "families", buyerPersona: "upgrader", emotions: ["warmth"],
  highlightSpaces: ["cocina"], hideSpaces: [], narrativeOrder: [],
  visualStyle: "warm editorial", recommendedPlatforms: [], recommendedDurationSec: 30,
  recommendedOutputs: [], bestRoiCombination: [], rationale: "r",
};
const shots: SelectedShot[] = [
  { photoId: "a", order: 0, roomType: "fachada", reason: "", suggestedMotion: "push-in" },
];

describe("buildGenerationPrompts", () => {
  it("produces one prompt per shot carrying geometry guardrails", () => {
    const out = buildGenerationPrompts(shots, strategy);
    expect(out).toHaveLength(1);
    expect(out[0].photoId).toBe("a");
    expect(out[0].shotOrder).toBe(0);
    expect(out[0].guardrails).toBe(GEOMETRY_GUARDRAILS);
    expect(out[0].prompt).toContain("push-in");
    expect(out[0].prompt.toLowerCase()).toContain("source of truth");
  });
  it("guardrails forbid inventing geometry", () => {
    expect(GEOMETRY_GUARDRAILS.toLowerCase()).toContain("do not add");
    expect(GEOMETRY_GUARDRAILS.toLowerCase()).toContain("walls");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/media-intelligence/prompts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/media-intelligence/prompts.ts
// Deterministic per-shot prompts. Mirrors the guardrail philosophy of
// LIVING_LISTING_PROMPT (src/lib/tour/processors/gemini-video.ts): the real
// photo is the source of truth; the model must not invent geometry.
import type {
  GenerationPrompt,
  MediaStrategy,
  SelectedShot,
} from "@/lib/media-intelligence/types";

export const GEOMETRY_GUARDRAILS = [
  "The uploaded photo is the SOURCE OF TRUTH.",
  "Do NOT add, remove, or move walls, rooms, windows, doors, or fixtures.",
  "Do NOT add furniture or decor. Do NOT reveal anything outside the framing.",
  "Preserve the exact layout, materials, lighting, colors, and proportions.",
  "No people, no text, no logos, no watermarks. If in doubt, move the camera less.",
].join(" ");

export function buildGenerationPrompts(
  shots: SelectedShot[],
  strategy: MediaStrategy,
): GenerationPrompt[] {
  return shots.map((shot) => ({
    shotOrder: shot.order,
    photoId: shot.photoId,
    prompt: [
      `Subtle cinematic real-estate micro-clip of the ${shot.roomType}.`,
      `Camera: ${shot.suggestedMotion}. Mood: ${strategy.visualStyle}.`,
      `The uploaded photo is the SOURCE OF TRUTH — faithful and photorealistic.`,
    ].join(" "),
    guardrails: GEOMETRY_GUARDRAILS,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/media-intelligence/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-intelligence/prompts.ts src/lib/media-intelligence/prompts.test.ts
git commit -m "feat(media-agent): per-shot generation prompts with geometry guardrails"
```

---

## Task 10: `deliverables.ts` — planned deliverable catalog

**Files:**
- Create: `src/lib/media-intelligence/deliverables.ts`
- Test: `src/lib/media-intelligence/deliverables.test.ts`

**Interfaces:**
- Consumes: `MediaStrategy`, `Deliverable`, `MediaCapability` (Task 1); `getSpecialist` (Task 6).
- Produces: `planDeliverables(strategy): Deliverable[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/media-intelligence/deliverables.test.ts
import { describe, it, expect } from "vitest";
import { planDeliverables } from "@/lib/media-intelligence/deliverables";
import type { MediaStrategy } from "@/lib/media-intelligence/types";

const strategy: MediaStrategy = {
  targetAudience: "a", buyerPersona: "b", emotions: [], highlightSpaces: [],
  hideSpaces: [], narrativeOrder: [], visualStyle: "s", recommendedPlatforms: [],
  recommendedDurationSec: 30,
  recommendedOutputs: [
    { capability: "video", engine: "mock", estimatedCostUsd: 0 },
    { capability: "voice", engine: "mock", estimatedCostUsd: 0 },
  ],
  bestRoiCombination: [], rationale: "r",
};

describe("planDeliverables", () => {
  it("plans deliverables for each recommended capability via its specialist", () => {
    const out = planDeliverables(strategy);
    const caps = new Set(out.map((d) => d.capability));
    expect(caps.has("video")).toBe(true);
    expect(caps.has("voice")).toBe(true);
    expect(out.every((d) => d.status === "planned")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/media-intelligence/deliverables.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/media-intelligence/deliverables.ts
// Turns the strategy's recommended outputs into concrete planned deliverables
// by asking each capability's specialist to plan. Deterministic.
import type { Deliverable, MediaStrategy } from "@/lib/media-intelligence/types";
import { getSpecialist } from "@/lib/media-intelligence/agents/registry";

export function planDeliverables(strategy: MediaStrategy): Deliverable[] {
  const capabilities = new Set(strategy.recommendedOutputs.map((o) => o.capability));
  const out: Deliverable[] = [];
  for (const capability of capabilities) {
    out.push(...getSpecialist(capability).plan(strategy));
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/media-intelligence/deliverables.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-intelligence/deliverables.ts src/lib/media-intelligence/deliverables.test.ts
git commit -m "feat(media-agent): plan deliverables from strategy via specialists"
```

---

## Task 11: LLM nodes — `classify.ts`, `quality.ts`, `strategy.ts`

**Files:**
- Create: `src/lib/media-intelligence/classify.ts`, `.../quality.ts`, `.../strategy.ts`
- Test: `src/lib/media-intelligence/strategy.test.ts`, `.../quality.test.ts`

**Interfaces:**
- Consumes: `Asset`, `Classification`, `QualityScore`, `MediaStrategy`, `MediaStrategyDraft`, `mediaStrategyDraftSchema`, `SelectedShot` (Task 1); `estimateCostUsd` (Task 2).
- Produces:
  - `classify.ts`: `ObjectGenerator`, `classifyAssets(assets, listingFacts, deps?): Promise<Classification[]>`
  - `quality.ts`: `scoreAssets(assets, deps?): Promise<QualityScore[]>`, `QUALITY_EXTENSION_POINT` (doc const)
  - `strategy.ts`: `buildStrategy(shots, classifications, listingFacts, deps?): Promise<MediaStrategy>`, `ListingFacts`

> `deps.generate` is an injected object-generation function so these nodes are
> unit-testable without hitting the model. In production it defaults to a thin
> wrapper over `generateObject` with `anthropic("claude-sonnet-4-6")`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/media-intelligence/quality.test.ts
import { describe, it, expect } from "vitest";
import { scoreAssets } from "@/lib/media-intelligence/quality";
import type { Asset } from "@/lib/media-intelligence/types";

describe("scoreAssets", () => {
  it("maps model output to normalized QualityScore rows", async () => {
    const assets: Asset[] = [{ photoId: "a", url: "http://x/a" }];
    const fakeGenerate = async () => ({
      object: { scores: [{ photoId: "a", sharpness: 0.8, lighting: 0.7, framing: 0.6, duplicateOf: null }] },
    });
    const out = await scoreAssets(assets, { generate: fakeGenerate as never });
    expect(out[0].photoId).toBe("a");
    expect(out[0].overall).toBeCloseTo((0.8 + 0.7 + 0.6) / 3, 5);
    expect(out[0].duplicateOf).toBeUndefined();
  });
});
```

```ts
// src/lib/media-intelligence/strategy.test.ts
import { describe, it, expect } from "vitest";
import { buildStrategy } from "@/lib/media-intelligence/strategy";
import type { Classification, SelectedShot } from "@/lib/media-intelligence/types";

describe("buildStrategy", () => {
  it("validates the draft and fills cost deterministically from the cost table", async () => {
    const shots: SelectedShot[] = [
      { photoId: "a", order: 0, roomType: "fachada", reason: "", suggestedMotion: "push" },
    ];
    const classes: Classification[] = [{ photoId: "a", roomType: "fachada", tags: [], confidence: 1 }];
    const fakeGenerate = async () => ({
      object: {
        targetAudience: "families", buyerPersona: "upgrader", emotions: ["warmth"],
        highlightSpaces: ["cocina"], hideSpaces: [], narrativeOrder: ["fachada"],
        visualStyle: "warm editorial",
        recommendedPlatforms: [{ platform: "instagram", rationale: "reach" }],
        recommendedDurationSec: 30,
        recommendedOutputs: [{ capability: "video", engine: "veo" }],
        bestRoiCombination: ["vertical_reel"], rationale: "because",
      },
    });
    const s = await buildStrategy(shots, classes, { price: 500000, beds: 3, baths: 2, city: "Miami" }, { generate: fakeGenerate as never });
    expect(s.targetAudience).toBe("families");
    // cost filled from cost-table for veo/video (> 0), NOT from the model
    expect(s.recommendedOutputs[0].estimatedCostUsd).toBeGreaterThan(0);
  });

  it("throws when the model output fails schema validation", async () => {
    const fakeGenerate = async () => ({ object: { targetAudience: 123 } });
    await expect(
      buildStrategy([], [], { price: 0, beds: 0, baths: 0, city: "x" }, { generate: fakeGenerate as never }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/media-intelligence/quality.test.ts src/lib/media-intelligence/strategy.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

```ts
// src/lib/media-intelligence/classify.ts
// LLM node: classify each photo by room type using Claude Vision. The object
// generator is injected for testability; production uses generateObject.
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { ROOM_TYPES, type Asset, type Classification } from "@/lib/media-intelligence/types";

const MODEL = "claude-sonnet-4-6";

export type ObjectGenerator = (args: {
  model: unknown;
  schema: unknown;
  messages: unknown;
}) => Promise<{ object: unknown }>;

const classificationsSchema = z.object({
  classifications: z.array(
    z.object({
      photoId: z.string(),
      roomType: z.enum(ROOM_TYPES),
      tags: z.array(z.string()),
      confidence: z.number(),
    }),
  ),
});

export async function classifyAssets(
  assets: Asset[],
  deps: { generate?: ObjectGenerator } = {},
): Promise<Classification[]> {
  if (assets.length === 0) return [];
  const generate = (deps.generate ?? (generateObject as unknown as ObjectGenerator));
  const { object } = await generate({
    model: anthropic(MODEL),
    schema: classificationsSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Classify each real-estate photo by room type. Return one entry per " +
              "photoId. Room types: " + ROOM_TYPES.join(", ") + ". " +
              "photoIds in order: " + assets.map((a) => a.photoId).join(", "),
          },
          ...assets.map((a) => ({ type: "image" as const, image: a.url })),
        ],
      },
    ],
  });
  const parsed = classificationsSchema.parse(object);
  return parsed.classifications;
}
```

```ts
// src/lib/media-intelligence/quality.ts
// LLM node: score each photo's sharpness/lighting/framing and flag near-dupes.
//
// EXTENSION POINT: v1 uses Claude Vision for perceptual scores. To swap in
// deterministic CV later (sharp/Laplacian variance for sharpness, perceptual
// hashing for duplicateOf), replace the body of scoreAssets — the signature and
// the QualityScore return shape are the stable contract callers depend on.
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Asset, QualityScore } from "@/lib/media-intelligence/types";
import type { ObjectGenerator } from "@/lib/media-intelligence/classify";

const MODEL = "claude-sonnet-4-6";

export const QUALITY_EXTENSION_POINT =
  "Replace scoreAssets() with deterministic CV (sharp/Laplacian + perceptual hash) here.";

const scoresSchema = z.object({
  scores: z.array(
    z.object({
      photoId: z.string(),
      sharpness: z.number(),
      lighting: z.number(),
      framing: z.number(),
      duplicateOf: z.string().nullable(),
    }),
  ),
});

export async function scoreAssets(
  assets: Asset[],
  deps: { generate?: ObjectGenerator } = {},
): Promise<QualityScore[]> {
  if (assets.length === 0) return [];
  const generate = deps.generate ?? (generateObject as unknown as ObjectGenerator);
  const { object } = await generate({
    model: anthropic(MODEL),
    schema: scoresSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Rate each real-estate photo 0..1 on sharpness, lighting, framing. " +
              "If a photo is a near-duplicate of a better one, set duplicateOf to " +
              "that photoId, else null. photoIds in order: " +
              assets.map((a) => a.photoId).join(", "),
          },
          ...assets.map((a) => ({ type: "image" as const, image: a.url })),
        ],
      },
    ],
  });
  const parsed = scoresSchema.parse(object);
  return parsed.scores.map((s) => ({
    photoId: s.photoId,
    sharpness: s.sharpness,
    lighting: s.lighting,
    framing: s.framing,
    overall: (s.sharpness + s.lighting + s.framing) / 3,
    duplicateOf: s.duplicateOf ?? undefined,
  }));
}
```

```ts
// src/lib/media-intelligence/strategy.ts
// LLM node: write the Media Strategy (the "mind"). The model returns a DRAFT
// (no prices); we validate it and fill estimatedCostUsd deterministically from
// the cost-table so prices are never hallucinated.
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  mediaStrategyDraftSchema,
  type Classification,
  type MediaStrategy,
  type SelectedShot,
} from "@/lib/media-intelligence/types";
import { estimateCostUsd } from "@/lib/media-intelligence/providers/cost-table";
import type { ObjectGenerator } from "@/lib/media-intelligence/classify";

const MODEL = "claude-sonnet-4-6";

export interface ListingFacts {
  price: number;
  beds: number;
  baths: number;
  city: string;
}

export async function buildStrategy(
  shots: SelectedShot[],
  classifications: Classification[],
  facts: ListingFacts,
  deps: { generate?: ObjectGenerator } = {},
): Promise<MediaStrategy> {
  const generate = deps.generate ?? (generateObject as unknown as ObjectGenerator);
  const { object } = await generate({
    model: anthropic(MODEL),
    schema: mediaStrategyDraftSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "You are a real-estate marketing strategist. Given this listing and its " +
              "selected hero shots, produce a Media Strategy. Do NOT include prices. " +
              `Listing: $${facts.price}, ${facts.beds}bd/${facts.baths}ba, ${facts.city}. ` +
              "Shots (order → room): " +
              shots.map((s) => `${s.order}:${s.roomType}`).join(", ") + ". " +
              "Rooms present: " +
              [...new Set(classifications.map((c) => c.roomType))].join(", ") + ". " +
              "recommendedOutputs.engine may be one of: mock, veo, kling, runway, luma, higgsfield, wan.",
          },
        ],
      },
    ],
  });
  const draft = mediaStrategyDraftSchema.parse(object);
  return {
    ...draft,
    recommendedOutputs: draft.recommendedOutputs.map((o) => ({
      capability: o.capability,
      engine: o.engine,
      estimatedCostUsd: estimateCostUsd(o.engine, o.capability),
    })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/media-intelligence/quality.test.ts src/lib/media-intelligence/strategy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-intelligence/classify.ts src/lib/media-intelligence/quality.ts src/lib/media-intelligence/strategy.ts src/lib/media-intelligence/quality.test.ts src/lib/media-intelligence/strategy.test.ts
git commit -m "feat(media-agent): Claude Vision classify/quality nodes + strategy node"
```

---

## Task 12: `ingest.ts` — load & validate assets

**Files:**
- Create: `src/lib/media-intelligence/ingest.ts`
- Test: `src/lib/media-intelligence/ingest.test.ts`

**Interfaces:**
- Consumes: `Asset` (Task 1).
- Produces: `PhotoRow`, `MIN_PHOTOS`, `toAssets(rows): Asset[]`, `TooFewPhotosError`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/media-intelligence/ingest.test.ts
import { describe, it, expect } from "vitest";
import { toAssets, MIN_PHOTOS, TooFewPhotosError } from "@/lib/media-intelligence/ingest";

describe("toAssets", () => {
  it("maps rows to assets and requires MIN_PHOTOS", () => {
    const rows = Array.from({ length: MIN_PHOTOS }, (_, i) => ({ id: `p${i}`, url: `http://x/${i}` }));
    const assets = toAssets(rows);
    expect(assets).toHaveLength(MIN_PHOTOS);
    expect(assets[0]).toEqual({ photoId: "p0", url: "http://x/0" });
  });
  it("drops rows with no url then throws if below the minimum", () => {
    const rows = [{ id: "a", url: "http://x/a" }, { id: "b", url: "" }];
    expect(() => toAssets(rows)).toThrow(TooFewPhotosError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/media-intelligence/ingest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/media-intelligence/ingest.ts
// Map property_photos rows to Assets and enforce a minimum usable count.
// (The route loads rows via the supabase client; this stays pure + testable.)
import type { Asset } from "@/lib/media-intelligence/types";

export const MIN_PHOTOS = 3;

export interface PhotoRow {
  id: string;
  url: string | null;
}

export class TooFewPhotosError extends Error {
  constructor(readonly have: number) {
    super(`need at least ${MIN_PHOTOS} usable photos, have ${have}`);
    this.name = "TooFewPhotosError";
  }
}

export function toAssets(rows: PhotoRow[]): Asset[] {
  const assets = rows
    .filter((r): r is { id: string; url: string } => Boolean(r.url))
    .map((r) => ({ photoId: r.id, url: r.url }));
  if (assets.length < MIN_PHOTOS) throw new TooFewPhotosError(assets.length);
  return assets;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/media-intelligence/ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-intelligence/ingest.ts src/lib/media-intelligence/ingest.test.ts
git commit -m "feat(media-agent): asset ingest + minimum-photo validation"
```

---

## Task 13: `agent.ts` — orchestrator

**Files:**
- Create: `src/lib/media-intelligence/agent.ts`
- Test: `src/lib/media-intelligence/agent.test.ts`

**Interfaces:**
- Consumes: everything above — `toAssets`/`Asset`, `classifyAssets`, `scoreAssets`, `selectHeroShots`, `buildStrategy`/`ListingFacts`, `buildGenerationPrompts`, `planDeliverables`, `getSpecialist`, `selectProvider`, jobs helpers, `StrategyPayload`.
- Produces: `AgentDeps`, `runMediaAgent(input, deps): Promise<StrategyPayload>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/media-intelligence/agent.test.ts
import { describe, it, expect, vi } from "vitest";
import { runMediaAgent } from "@/lib/media-intelligence/agent";
import type { AgentDeps } from "@/lib/media-intelligence/agent";
import type { Classification, MediaStrategy, QualityScore } from "@/lib/media-intelligence/types";

function deps(overrides: Partial<AgentDeps> = {}): AgentDeps {
  const strategy: MediaStrategy = {
    targetAudience: "a", buyerPersona: "b", emotions: [], highlightSpaces: [],
    hideSpaces: [], narrativeOrder: [], visualStyle: "s", recommendedPlatforms: [],
    recommendedDurationSec: 30,
    recommendedOutputs: [{ capability: "video", engine: "mock", estimatedCostUsd: 0 }],
    bestRoiCombination: [], rationale: "r",
  };
  const classes: Classification[] = [
    { photoId: "a", roomType: "fachada", tags: [], confidence: 1 },
    { photoId: "b", roomType: "sala", tags: [], confidence: 1 },
    { photoId: "c", roomType: "cocina", tags: [], confidence: 1 },
  ];
  const scores: QualityScore[] = classes.map((c) => ({
    photoId: c.photoId, sharpness: 0.8, lighting: 0.8, framing: 0.8, overall: 0.8,
  }));
  return {
    loadAssets: vi.fn(async () => classes.map((c) => ({ photoId: c.photoId, url: `http://x/${c.photoId}` }))),
    classify: vi.fn(async () => classes),
    score: vi.fn(async () => scores),
    strategy: vi.fn(async () => strategy),
    listingFacts: vi.fn(async () => ({ price: 1, beds: 1, baths: 1, city: "x" })),
    setStatus: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("runMediaAgent", () => {
  it("runs the pipeline and returns a completed payload", async () => {
    const d = deps();
    const payload = await runMediaAgent({ jobId: "j1", propertyId: "p1", ownerId: "o1" }, d);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.selectedShots.length).toBe(3);
    expect(payload.deliverables.length).toBeGreaterThan(0);
    expect(payload.providersUsed.video).toBe("mock");
    // status walked pending→analyzing→generating (completed handled by caller)
    expect(d.setStatus).toHaveBeenCalledWith("j1", "analyzing");
    expect(d.setStatus).toHaveBeenCalledWith("j1", "generating");
  });

  it("propagates stage errors (caller marks the job failed)", async () => {
    const d = deps({ classify: vi.fn(async () => { throw new Error("vision down"); }) });
    await expect(runMediaAgent({ jobId: "j1", propertyId: "p1", ownerId: "o1" }, d)).rejects.toThrow("vision down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/media-intelligence/agent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/media-intelligence/agent.ts
// The Media Intelligence Agent orchestrator. Deterministic control flow; LLM
// work happens inside injected deps (loadAssets/classify/score/strategy) so the
// whole pipeline is unit-testable. Persistence + final status are handled by the
// caller (the route) — this returns the completed StrategyPayload or throws.
import { STRATEGY_SCHEMA_VERSION, type MediaCapability, type StrategyPayload } from "@/lib/media-intelligence/types";
import type { Asset, Classification, MediaStrategy, QualityScore } from "@/lib/media-intelligence/types";
import type { MediaJobStatus } from "@/lib/media-intelligence/types";
import type { ListingFacts } from "@/lib/media-intelligence/strategy";
import { selectHeroShots } from "@/lib/media-intelligence/select";
import { buildGenerationPrompts } from "@/lib/media-intelligence/prompts";
import { planDeliverables } from "@/lib/media-intelligence/deliverables";
import { getSpecialist } from "@/lib/media-intelligence/agents/registry";
import { selectProvider } from "@/lib/media-intelligence/providers";

export interface AgentDeps {
  loadAssets(propertyId: string): Promise<Asset[]>;
  classify(assets: Asset[]): Promise<Classification[]>;
  score(assets: Asset[]): Promise<QualityScore[]>;
  strategy(shots: ReturnType<typeof selectHeroShots>, classifications: Classification[], facts: ListingFacts): Promise<MediaStrategy>;
  listingFacts(propertyId: string): Promise<ListingFacts>;
  setStatus(jobId: string, status: MediaJobStatus): Promise<void>;
}

export interface RunInput {
  jobId: string;
  propertyId: string;
  ownerId: string;
}

function log(jobId: string, stage: string, msg: string) {
  console.log(`[media-agent] job=${jobId} stage=${stage} ${msg}`);
}

export async function runMediaAgent(
  input: RunInput,
  deps: AgentDeps,
): Promise<StrategyPayload> {
  const { jobId, propertyId } = input;

  await deps.setStatus(jobId, "analyzing");
  log(jobId, "ingest", "loading assets");
  const assets = await deps.loadAssets(propertyId);

  log(jobId, "classify", `classifying ${assets.length} assets`);
  const classifications = await deps.classify(assets);

  log(jobId, "quality", "scoring assets");
  const scores = await deps.score(assets);

  log(jobId, "select", "selecting hero shots");
  const selectedShots = selectHeroShots(assets, classifications, scores);

  log(jobId, "strategy", "building media strategy");
  const facts = await deps.listingFacts(propertyId);
  const mediaStrategy = await deps.strategy(selectedShots, classifications, facts);

  const generationPrompts = buildGenerationPrompts(selectedShots, mediaStrategy);
  const deliverables = planDeliverables(mediaStrategy);

  await deps.setStatus(jobId, "generating");
  log(jobId, "generate", `dispatching ${deliverables.length} deliverables (mock)`);
  const providersUsed: Partial<Record<MediaCapability, string>> = {};
  for (const deliverable of deliverables) {
    const specialist = getSpecialist(deliverable.capability);
    const provider = selectProvider(deliverable.capability); // mock in v1
    const result = await specialist.execute(deliverable, provider);
    deliverable.status = result.status === "mock" ? "mock" : "planned";
    providersUsed[deliverable.capability] = provider.id;
  }

  return {
    schemaVersion: STRATEGY_SCHEMA_VERSION,
    assets,
    classifications,
    scores,
    selectedShots,
    mediaStrategy,
    generationPrompts,
    deliverables,
    providersUsed,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/media-intelligence/agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-intelligence/agent.ts src/lib/media-intelligence/agent.test.ts
git commit -m "feat(media-agent): pipeline orchestrator"
```

---

## Task 14: Route `POST /api/media-agent/generate`

**Files:**
- Create: `src/app/api/media-agent/generate/route.ts`
- Test: `src/app/api/media-agent/generate/route.test.ts`

**Interfaces:**
- Consumes: `createClient` (`@/lib/supabase/server`), `apiLimiter`/`enforceLimit` (`@/lib/ratelimit`), `runMediaAgent`/`AgentDeps` (Task 13), jobs helpers (Task 7), `classifyAssets`/`scoreAssets`/`buildStrategy` (Task 11), `toAssets` (Task 12).
- Produces: `isMediaAgentEnabled(): boolean`, `POST(req)`.

> The heavy wiring (auth, RLS, service client, LLM deps) can only be verified by
> running it. The one cheaply-unit-testable seam is the flag gate — test that.
> Everything else is verified via the manual smoke test in Step 6.

- [ ] **Step 1: Write the failing test (flag gate)**

```ts
// src/app/api/media-agent/generate/route.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isMediaAgentEnabled } from "@/app/api/media-agent/generate/route";

describe("isMediaAgentEnabled", () => {
  const prev = process.env.MEDIA_AGENT_ENABLED;
  afterEach(() => { process.env.MEDIA_AGENT_ENABLED = prev; });
  it("is off unless the env flag is exactly 'true'", () => {
    process.env.MEDIA_AGENT_ENABLED = undefined;
    expect(isMediaAgentEnabled()).toBe(false);
    process.env.MEDIA_AGENT_ENABLED = "false";
    expect(isMediaAgentEnabled()).toBe(false);
    process.env.MEDIA_AGENT_ENABLED = "true";
    expect(isMediaAgentEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/media-agent/generate/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/api/media-agent/generate/route.ts
// POST /api/media-agent/generate — body: { property_id }
//
// Flow: flag gate → auth → rate-limit → validate → ownership → create job →
// run pipeline synchronously (mock render) → persist → return payload.
// v1 produces NO real media; every deliverable is mock.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";
import { runMediaAgent, type AgentDeps } from "@/lib/media-intelligence/agent";
import { createJob, completeJob, failJob } from "@/lib/media-intelligence/jobs";
import { setJobStatus } from "@/lib/media-intelligence/jobs";
import { toAssets } from "@/lib/media-intelligence/ingest";
import { classifyAssets } from "@/lib/media-intelligence/classify";
import { scoreAssets } from "@/lib/media-intelligence/quality";
import { buildStrategy } from "@/lib/media-intelligence/strategy";
import type { ListingFacts } from "@/lib/media-intelligence/strategy";

export const maxDuration = 300;

export function isMediaAgentEnabled(): boolean {
  return process.env.MEDIA_AGENT_ENABLED === "true";
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("supabase service credentials not configured");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

interface Body {
  property_id?: string;
}

export async function POST(req: Request) {
  if (!isMediaAgentEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const limited = await enforceLimit(
    apiLimiter("media-agent:generate", 3, "1 h"),
    `u:${user.id}`,
    { label: "media-agent:generate", message: "Too many requests. Please wait." },
  );
  if (limited) return limited;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const propertyId = body.property_id;
  if (!propertyId) {
    return NextResponse.json({ error: "property_id_required" }, { status: 400 });
  }

  // Ownership via RLS: the user can only read their own property + its photos.
  const { data: property } = await supabase
    .from("properties")
    .select("id, price, bedrooms, bathrooms, city")
    .eq("id", propertyId)
    .maybeSingle();
  if (!property) {
    return NextResponse.json({ error: "property_not_found_or_not_yours" }, { status: 403 });
  }

  const { data: photoRows } = await supabase
    .from("property_photos")
    .select("id, url")
    .eq("property_id", propertyId)
    .eq("is_staged", false)
    .order("display_order", { ascending: true });

  let assets;
  try {
    assets = toAssets(photoRows ?? []);
  } catch {
    return NextResponse.json({ error: "too_few_photos", min: 3 }, { status: 422 });
  }

  const svc = serviceClient();
  const jobId = await createJob(svc as never, { propertyId, ownerId: user.id });

  const deps: AgentDeps = {
    loadAssets: async () => assets,
    classify: (a) => classifyAssets(a),
    score: (a) => scoreAssets(a),
    strategy: (shots, classifications, facts) => buildStrategy(shots, classifications, facts),
    listingFacts: async (): Promise<ListingFacts> => ({
      price: Number(property.price ?? 0),
      beds: Number(property.bedrooms ?? 0),
      baths: Number(property.bathrooms ?? 0),
      city: String(property.city ?? ""),
    }),
    setStatus: (id, status) => setJobStatus(svc as never, id, status),
  };

  try {
    const payload = await runMediaAgent({ jobId, propertyId, ownerId: user.id }, deps);
    const providers = Object.values(payload.providersUsed).join(",") || "mock";
    await completeJob(svc as never, jobId, payload, providers);
    return NextResponse.json({ jobId, status: "completed", strategy: payload });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "pipeline_error";
    console.error(`[media-agent] job=${jobId} failed: ${msg}`);
    await failJob(svc as never, jobId, msg);
    return NextResponse.json({ error: "pipeline_failed", detail: msg, jobId }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/media-agent/generate/route.test.ts`
Expected: PASS.

> **Note on the `properties` columns:** this route reads `price, bedrooms,
> bathrooms, city`. Before running, confirm these column names against
> `supabase/migrations/20260520151434_remote_baseline.sql` (the `properties`
> table). If a column differs (e.g. `beds`/`baths`), adjust the `.select()` and
> the `listingFacts` mapping to match — do not invent columns.

- [ ] **Step 5: Full quality gates**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm migrations:check`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/media-agent/generate/route.ts src/app/api/media-agent/generate/route.test.ts
git commit -m "feat(media-agent): POST /api/media-agent/generate route (flag-gated, mock render)"
```

---

## Task 15: i18n copy (`mediaAgent.*`)

**Files:**
- Modify: `src/lib/i18n.ts` (add `mediaAgent` under both `en` and `es`)
- Test: `src/lib/media-intelligence/i18n-parity.test.ts`

**Interfaces:**
- Produces: `dictionaries.en.mediaAgent`, `dictionaries.es.mediaAgent` (same key shape).

- [ ] **Step 1: Write the failing test (EN/ES parity for the new block)**

```ts
// src/lib/media-intelligence/i18n-parity.test.ts
import { describe, it, expect } from "vitest";
import { dictionaries } from "@/lib/i18n";

describe("mediaAgent i18n", () => {
  it("has the same keys in en and es", () => {
    const en = Object.keys((dictionaries.en as Record<string, unknown>).mediaAgent ?? {}).sort();
    const es = Object.keys((dictionaries.es as Record<string, unknown>).mediaAgent ?? {}).sort();
    expect(en.length).toBeGreaterThan(0);
    expect(en).toEqual(es);
  });
});
```

> If `dictionaries` is not currently exported from `src/lib/i18n.ts`, add
> `export` to the `const dictionaries = {...}` declaration (it is referenced by
> the existing dictionary getter; exporting it is additive and safe).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/media-intelligence/i18n-parity.test.ts`
Expected: FAIL — `mediaAgent` undefined (or `dictionaries` not exported).

- [ ] **Step 3: Add the copy block**

In `src/lib/i18n.ts`, inside `dictionaries.en`, add a `mediaAgent` key (place it near the `staging*`/`living*` groups). Use this exact object:

```ts
    mediaAgent: {
      cta: "Generate marketing package",
      generating: "Analyzing your photos…",
      strategyTitle: "Media Strategy",
      audience: "Target audience",
      persona: "Buyer persona",
      emotions: "Emotions",
      highlight: "Spaces to highlight",
      hide: "Spaces to de-emphasize",
      narrative: "Narrative order",
      style: "Visual style",
      platforms: "Best platforms",
      duration: "Suggested duration",
      outputs: "Recommended outputs",
      estCost: "Est. cost",
      roi: "Best ROI combination",
      shots: "Selected shots",
      deliverables: "Deliverables",
      approve: "Approve",
      regenerate: "Regenerate",
      variant: "Request a different version",
      mockBadge: "Preview (not yet rendered)",
      disclosure:
        "AI-assisted marketing preview. Any generated media will be clearly disclosed and must faithfully represent the property.",
      tooFewPhotos: "Add at least 3 photos to generate a marketing package.",
      failed: "Something went wrong. Please try again.",
    },
```

Then, inside `dictionaries.es`, add the mirrored block with the SAME keys:

```ts
    mediaAgent: {
      cta: "Generar paquete de marketing",
      generating: "Analizando tus fotos…",
      strategyTitle: "Estrategia de medios",
      audience: "Público objetivo",
      persona: "Perfil del comprador",
      emotions: "Emociones",
      highlight: "Espacios a resaltar",
      hide: "Espacios a restar énfasis",
      narrative: "Orden narrativo",
      style: "Estilo visual",
      platforms: "Mejores plataformas",
      duration: "Duración sugerida",
      outputs: "Salidas recomendadas",
      estCost: "Costo est.",
      roi: "Mejor combinación de ROI",
      shots: "Tomas seleccionadas",
      deliverables: "Entregables",
      approve: "Aprobar",
      regenerate: "Regenerar",
      variant: "Solicitar otra versión",
      mockBadge: "Vista previa (aún no renderizado)",
      disclosure:
        "Vista previa de marketing asistida por IA. Cualquier medio generado se divulgará claramente y debe representar fielmente la propiedad.",
      tooFewPhotos: "Agrega al menos 3 fotos para generar el paquete de marketing.",
      failed: "Algo salió mal. Inténtalo de nuevo.",
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/media-intelligence/i18n-parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n.ts src/lib/media-intelligence/i18n-parity.test.ts
git commit -m "feat(media-agent): bilingual mediaAgent copy (en/es)"
```

---

## Task 16: Dashboard surface — `MediaStrategyPanel` + trigger + read

**Files:**
- Create: `src/components/media-strategy-panel.tsx` (client)
- Modify: `src/app/[lang]/dashboard/page.tsx` (Server Component read + mount the panel behind the flag)

**Interfaces:**
- Consumes: `POST /api/media-agent/generate` (Task 14); `dictionaries` copy (Task 15); latest `media_agent_jobs` row for a property.
- Produces: `MediaStrategyPanel` React component.

> This is UI. It is verified by running the app (Step 4), not by a unit test.

- [ ] **Step 1: Create the client panel**

```tsx
// src/components/media-strategy-panel.tsx
"use client";

import { useState } from "react";
import type { StrategyPayload } from "@/lib/media-intelligence/types";

interface Copy {
  cta: string;
  generating: string;
  strategyTitle: string;
  audience: string;
  persona: string;
  shots: string;
  deliverables: string;
  approve: string;
  regenerate: string;
  variant: string;
  mockBadge: string;
  disclosure: string;
  tooFewPhotos: string;
  failed: string;
}

export function MediaStrategyPanel({
  propertyId,
  initial,
  copy,
}: {
  propertyId: string;
  initial: StrategyPayload | null;
  copy: Copy;
}) {
  const [payload, setPayload] = useState<StrategyPayload | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/media-agent/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ property_id: propertyId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error === "too_few_photos" ? copy.tooFewPhotos : copy.failed);
        return;
      }
      setPayload(data.strategy as StrategyPayload);
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 p-6">
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-serif text-xl">{copy.strategyTitle}</h3>
        <button
          onClick={generate}
          disabled={busy}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? copy.generating : payload ? copy.regenerate : copy.cta}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {payload && (
        <div className="mt-4 space-y-4 text-sm">
          <p>
            <strong>{copy.audience}:</strong> {payload.mediaStrategy.targetAudience}
          </p>
          <p>
            <strong>{copy.persona}:</strong> {payload.mediaStrategy.buyerPersona}
          </p>

          <div>
            <p className="font-medium">{copy.shots}</p>
            <ol className="mt-1 list-decimal pl-5">
              {payload.selectedShots.map((s) => (
                <li key={s.photoId}>
                  {s.roomType} — {s.suggestedMotion}
                </li>
              ))}
            </ol>
          </div>

          <div>
            <p className="font-medium">{copy.deliverables}</p>
            <ul className="mt-1 grid gap-2 sm:grid-cols-2">
              {payload.deliverables.map((d) => (
                <li key={d.id} className="rounded-lg border border-neutral-200 p-3">
                  <div className="flex items-center justify-between">
                    <span>{d.kind} · {d.aspect}</span>
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      {copy.mockBadge}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button className="rounded border px-2 py-1 text-xs">{copy.approve}</button>
                    <button className="rounded border px-2 py-1 text-xs">{copy.variant}</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-neutral-500">{copy.disclosure}</p>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Mount it in the dashboard behind the flag**

In `src/app/[lang]/dashboard/page.tsx` (a Server Component), for each of the seller's submitted properties, read the latest job and render the panel. Add near where a property's cards are rendered:

```tsx
// top of file — imports
import { MediaStrategyPanel } from "@/components/media-strategy-panel";
import type { StrategyPayload } from "@/lib/media-intelligence/types";

// inside the async Server Component, after `supabase` and `dict` (the resolved
// dictionary for `lang`) are available, and for a given `property.id`:
const mediaAgentEnabled = process.env.MEDIA_AGENT_ENABLED === "true";
let latestStrategy: StrategyPayload | null = null;
if (mediaAgentEnabled) {
  const { data: job } = await supabase
    .from("media_agent_jobs")
    .select("strategy, status")
    .eq("property_id", property.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  latestStrategy =
    job?.status === "completed" ? (job.strategy as StrategyPayload) : null;
}

// …and in the JSX for that property:
{mediaAgentEnabled && (
  <MediaStrategyPanel
    propertyId={property.id}
    initial={latestStrategy}
    copy={dict.mediaAgent}
  />
)}
```

> Match the actual variable names in `dashboard/page.tsx` for the supabase
> client, the resolved dictionary, and the property loop. Read the file first;
> do not assume `dict`/`property` verbatim — adapt to what's there.

- [ ] **Step 3: Quality gates**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 4: Manual verification (flag on, local)**

```bash
MEDIA_AGENT_ENABLED=true pnpm dev
```
Sign in as a seller with a submitted listing that has ≥3 photos, open the
dashboard, click **Generate marketing package**, and confirm: the button shows
the analyzing state, then the Media Strategy, selected shots, and mock
deliverable cards render, with the disclosure line visible.

> Requires `MEDIA_AGENT_ENABLED=true` **and** the migration applied by the owner
> (Task 7). If the migration is not yet applied, the route returns a 500 on the
> job insert — expected until sign-off.

- [ ] **Step 5: Commit**

```bash
git add src/components/media-strategy-panel.tsx src/app/[lang]/dashboard/page.tsx
git commit -m "feat(media-agent): dashboard MediaStrategyPanel + flag-gated trigger"
```

---

## Task 17: Documentation + final gates

**Files:**
- Modify: `CLAUDE.md` (env var section)

- [ ] **Step 1: Document the env var**

In `CLAUDE.md`, under "Environment variables", add:

```markdown
- `MEDIA_AGENT_ENABLED` — server-only feature flag (`"true"` to enable). Gates the
  Media Intelligence Agent route (`/api/media-agent/generate`) and its dashboard
  surface. v1 produces mock deliverables only (no real media generation). Reuses
  the existing Anthropic access (`@ai-sdk/anthropic`); no new provider keys in v1.
```

- [ ] **Step 2: Run the full quality gate suite**

Run: `pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm migrations:check && pnpm build`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(media-agent): document MEDIA_AGENT_ENABLED flag"
```

- [ ] **Step 4: Owner hand-off note (do not run db push yourself)**

Tell the owner: apply the migration with `supabase db push` after reviewing
`supabase/migrations/<ts>_create_media_agent_jobs.sql`, then set
`MEDIA_AGENT_ENABLED=true` locally and/or `vercel env add MEDIA_AGENT_ENABLED`
for a preview deploy to exercise it end-to-end.

---

## Self-review notes

- **Spec coverage:** analysis pipeline (Tasks 8–13), Media Strategy (Task 11), `MediaGenerationProvider` hierarchy + Mock + Veo + stubs (Tasks 3–5), specialist layer (Task 6), single `media_agent_jobs` jsonb table (Task 7), flag `MEDIA_AGENT_ENABLED` (Tasks 14, 16, 17), open beta / no tier gate (Task 16 renders whenever flag on), route + validation + errors + logging (Task 14), tests (every task), i18n en/es (Task 15), Server-Component read with GET deferred (Task 16), compliance guardrails (Task 9 prompts, Task 15 disclosure), build order architecture→interfaces→persistence→orchestration→UI (task sequence). All mapped.
- **Cost integrity:** prices only from `cost-table.ts` (Task 2), never the LLM (Task 11 maps draft→strategy).
- **No real generation:** MockProvider only is selected (Task 5 `selectProvider` default; Task 13 calls it without `allowLive`).
- **Non-breaking:** no touches to `property_photos` schema, the wizard, `tour_jobs`, or staging/tour routes; migration is author-only.
```
