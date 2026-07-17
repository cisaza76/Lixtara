# Lixtara Creative Studio — product-oriented architecture

**Status:** Design under review (product-oriented refactor of the media program)
**Date:** 2026-07-14
**Author:** Camilo Isaza + Claude
**Supersedes:** the provider-oriented "four pipelines" framing, and the earlier
"Generation Engine" naming.
**Scope of THIS plan:** the **architecture is designed to be stable for 5–10 years**; the
**implementation target of the plan that follows is a single first slice** — a real,
deterministic **listing video** produced through the engine stack behind the Seller Studio
(phases P0→P2). Generative providers (P3) and the Tour Engine (separate spec) are documented
but not built here.
**Companion:** navigable 3D tour → `2026-07-14-3d-tour-spatial-workstream.md` (Tour Engine,
provider still an open decision).

---

## 1. The product is one screen

The seller does not buy AI, Veo, Luma, Claude, or Remotion. They open the **Lixtara
Creative Studio** and answer one question:

```
   My property
        │
        ▼
   What do you want to create?
     • Listing / MLS video      • Instagram Reel        • Story
     • TikTok / Shorts          • Flyer / Brochure PDF  • Virtual staging
     • Enhanced photos          • Thumbnail             • 3D tour
     • Landing / email / copy (future)
```

**The entire architecture below exists only to answer that question.** Everything —
intelligence, cost decisions, engines, providers, QA, policy — happens behind this screen.
Providers are an internal detail the seller never sees.

Renaming "Media Agent" → **Lixtara Creative Studio** is deliberate: within a year this
generates photos, videos, reels, flyers, brochures, ads, campaigns, landing pages, emails,
copy, posts, descriptions, presentations, and 3D tours. That is a creative platform for
marketing property, not a "media agent."

> **Naming vs code (DECIDED 2026-07-14):** "Lixtara Creative Studio" is the product name in
> all product/architecture/UI surfaces from now. The existing code identifiers
> (`MEDIA_AGENT_ENABLED`, table `media_agent_jobs`, `/api/media-agent/*`) **stay unchanged
> in P0** to avoid churn and let PR #81 merge cleanly. A code-identifier rename is deferred
> to a dedicated later pass, never done silently.

---

## 2. Two design principles

### 2.1 Capabilities, not providers
We describe the system as **capabilities**, never as provider pipelines. There is no
"Pipeline Veo" or "Pipeline Luma" — the day Veo becomes OpenAI, a provider-named architecture
is obsolete. Each engine exposes a **registry of capabilities** (a plugin model); each
capability is backed by one or more interchangeable **provider adapters**. Adding Runway does
not change the product — it registers new capabilities.

```
Video Engine  ── capabilities: AI Video · Slideshow · MLS Video · TikTok · Reel · Story
                 adapters:     Remotion (deterministic) · Veo · Runway · Kling · (future)
Image Engine  ── capabilities: Generate · Enhance · Color-correct · Object-removal · Sky-swap · HDR · Crop
                 adapters:     Luma · OpenAI · Nano Banana · (future)
Tour Engine   ── capabilities: Navigable 3D · 360° · Guided-video
                 adapters:     TBD (separate workstream)
```

### 2.2 Creative, not just generative
The engine layer is the **Creative Engine** — not "Generation Engine." Much of the value is
**not** generation: color correction, object removal, sky replacement, crop, HDR, upscaling,
re-use of existing assets. Those are creative operations on media that already exists.
"Generation Engine" implies AI-only; "Creative Engine" covers generate · improve · edit ·
optimize · transform · reuse.

---

## 3. Architecture

```
                    ┌──────────────────────────┐
                    │      Seller Studio        │  "What do you want to create?"
                    └────────────┬─────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │    Media Intelligence     │  decide what to make — AND what NOT to
                    │  (Media Strategy + gates) │  (readiness / suppression, with reasons)
                    └────────────┬─────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │  Entitlement gate (HARD)  │  plan · credits · approval · completeness
                    │      no override          │  — the only thing that can BLOCK
                    ├──────────────────────────┤
                    │   Cost Engine (SOFT)      │  a Decision Engine specialized in cost:
                    │   recommends, never       │  estimate + recommend; user may "generate
                    │   blocks; override learns │  anyway"; every override is a learning signal
                    └────────────┬─────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │      Creative Engine      │  generate·improve·edit·optimize·transform·reuse
                    └────────────┬─────────────┘
                 ┌───────────────┼───────────────┐
                 ▼               ▼               ▼
          ┌───────────┐   ┌───────────┐   ┌───────────┐
          │  Image    │   │  Video    │   │  Tour     │   each = a capability registry
          │  Engine   │   │  Engine   │   │  Engine   │   of pluggable provider adapters
          └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
                └───────────────┼───────────────┘
                    reads / writes every asset via
                                 ▼
          ╔══════════════════════════════════════════════╗
          ║               ASSET MANAGER                    ║  the core — no engine ever
          ║  immutable, versioned Assets (v1→v2→v3…)        ║  touches raw files, only Assets;
          ║  bytes · metadata · prompts · provenance ·     ║  nothing is ever overwritten,
          ║  QA verdicts · history · cache                 ║  every change is a new version
          ╚══════════════════════┬═══════════════════════╝
                                 ▼
                    ┌──────────────────────────┐
                    │      Media QA Agent       │  fidelity: did it hallucinate?
                    └────────────┬─────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │    Media Policy Engine    │  compliance before publish
                    └────────────┬─────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │     Approval Workflow     │  Generated→Review→Approved→Published
                    │     (versioned, rollback) │  (rollback / compare)
                    └────────────┬─────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │    Distribution Engine    │  publish · download · share · send ·
                    │                           │  sync · export → MLS · Zillow · home.com ·
                    │                           │  PDF · Email · WhatsApp · social · ZIP · API
                    └────────────┬─────────────┘
                                 ▼
                              Listing / channels
```

### 3.1 Decision-before-spend ordering

Decisions happen **before** any money is spent, in this order. Two kinds of rule — **hard**
(can block, no override) and **soft** (recommends only) — and they are never conflated:

1. **Media Intelligence — should this exist?** Classifies, scores, selects hero shots, and
   produces the Media Strategy *including explicit suppressions*: no 3D tour with 4 photos,
   no reel missing interiors, no staging on an unusably bad photo, no video while the listing
   is not approved. Knowing when to say **"no"** is as important as knowing what to make.
2. **Entitlement gate — HARD rule, no override.** The only thing that can *block*. Plan does
   not include the capability (Tour on Essentials), no credits, listing not approved,
   incomplete asset for MLS → **blocked**. The user cannot override a hard rule.
3. **Cost Engine — SOFT rule, recommends only, never blocks.** For each still-eligible
   candidate it estimates cost and expected value and **recommends** generate or skip, always
   surfacing the reason and always offering **"Generate anyway"**:

   > *Veo clip · est. $2.10 — not recommended: few photos, low quality, low expected ROI.*
   > `[ Cancel ]  [ Generate anyway ]`

   The AI does not know the seller's full context (a reel needed for tomorrow's buyer
   meeting; a premium broker experimenting with a new capability). So control stays with the
   user. **Every override is recorded** — rejection reason, the user's decision, the obtained
   result — so the Cost Engine *learns* ("model said no, user said yes, outcome was good 74%
   of the time"). Internally this is a **Decision Engine specialized in cost**; over time it
   will also weigh time, provider, quality, priority, cache, queue, and credits — it is named
   Cost Engine today but architected as a decision engine, not a cost lookup.
4. **Creative Engine — make it.** Runs every candidate that passed the hard gate, honoring
   the Cost Engine recommendation *or* the user's override.

#### Readiness model (locked 2026-07-14)

"What NOT to generate" is **not one boolean and not the same as entitlement or cost**.
Readiness answers only: *do the assets + listing state allow producing this capability at
acceptable quality?* It never evaluates cost, never picks a provider, never checks the plan.

- **Per capability, never global.** There is no `listingReady`. A listing can be *ready* for
  a slideshow and *not ready* for a reel or a 3D tour. Each capability is evaluated
  independently → the model scales when new engines arrive.
- **Two orthogonal axes**, not conflated:
  - `status: "ready" | "not_ready"` — technical possibility. `not_ready` is a **hard** block
    (no override in P1).
  - `recommendation: "recommended" | "not_recommended"` — product advice. A capability can be
    *ready but not_recommended* (e.g. only one exterior photo → the reel would be weak);
    override is allowed later.
- **Structured reason codes, not free text.** Reasons are stable enum codes + params
  (`{ code: "too_few_photos_for_tour", params: { min: 8, have: 4 } }`); the UI localizes them.
  **Multiple reasons can apply at once.**
- **Suggested actions are structured too** (`add_interior_photos`, `await_listing_approval`,
  …) so the UI can show one concrete next step per capability.
- **Deterministic + LLM-free.** The LLM may *recommend* outputs, but it can never skip the
  readiness gate. A suppressed capability **never** touches an asset or a provider.
- **The API differentiates** `available` (status ready), `recommended`, `suppressed` (with
  reasons), and `generated` (a result exists) — never a single `canGenerate` boolean, which
  would break once Cost Engine, entitlement, approval, and policy are added.

Canonical shape (preserve the semantic separation; exact fields may vary):

```ts
type CapabilityReadiness = {
  capability: MediaCapability;
  status: "ready" | "not_ready";
  recommendation: "recommended" | "not_recommended";
  reasons: ReadinessReason[];            // stable codes + params, may be several
  suggestedActions: SuggestedAction[];   // one concrete step per capability
};
```

**UI rules:** never present `not_ready`/`not_recommended` as a technical error. Show it as an
actionable recommendation ("Before creating this video, add at least 3 interior photos").
Never leak internal terms (readiness, suppression, provider, "Media Agent"); the product name
is **Lixtara Creative Studio**. Cover states: empty · analyzing · ready · not recommended ·
error. Verify EN + ES and mobile responsive.

### 3.2 Components (what / how used / depends on)

- **Seller Studio** — the product UI; the "what do you want to create?" screen + results.
  Depends on: Creative Engine job API, Asset Manager reads, Approval Workflow. Knows nothing
  about providers.
- **Media Intelligence** — format-agnostic; the only "thinking" layer. Produces the
  versioned Media Strategy *and its suppressions*. Depends on: Claude Vision. (Already real +
  unit-tested in the current module.)
- **Cost Engine** — *(new)* a **Decision Engine specialized in cost**. Turns cost into a
  **soft recommendation** (never a block — only the entitlement gate blocks), always
  override-able, and **records every override as a learning signal** to improve future
  recommendations. Depends on: `pricing-tiers.ts`, the provider cost table (exists:
  `providers/cost-table.ts`), the seller's plan, and an override-log store.
- **Entitlement gate** — *(new, hard rule)* the only place that can block generation or
  publication: plan capability, credits, listing approval, asset completeness. Not an engine
  — a set of hard preconditions enforced at the relevant step (plan/credits before
  generation; approval before publish; completeness before distribution). No override.
- **Creative Engine** — *(renamed from Generation Engine)* executes the approved strategy by
  dispatching to capability engines. Depends on: engine interfaces only.
- **Image / Video / Tour Engines** — each exposes a **capability registry**; each capability
  maps to provider adapters behind a stable interface. An adapter with no configured provider
  throws `ProviderNotConfiguredError` — never fakes output.
- **Asset Manager** — *(new, the core)* every piece of media is an **Asset**, not a file.
  Assets are **immutable and versioned** — nothing is ever overwritten; every change creates a
  new version (`LivingRoom v1 → v2 → v3`). Stores bytes (existing buckets) + version chain,
  metadata, the prompt used, provenance (source photos, provider, capability), QA verdict,
  policy verdict, and approval state. Engines read and write **only Assets**. Immutability is
  what makes rollback, comparison, cache, regeneration, legal compliance, reproducibility, and
  debugging trivial instead of bespoke per engine.
- **Media QA Agent** — *(new)* reviews generated output for fidelity (pink sky, a kitchen
  that vanished, an invented window, a changed pool, wrong proportions). **Depth scales with
  how generative the output is:** deep + blocking for generative output (Veo/Luma staging),
  light (framing/order) for deterministic Remotion output where hallucination is impossible.
- **Media Policy Engine** — *(new)* compliance gate before publish: Fair Housing, MLS rules,
  portal rules (Zillow/REALTOR®), copyright, disclosure, AI badge, watermark, seller
  approval. Reuses existing legal primitives (`livingDisclaimer`, staging badge).
- **Approval Workflow** — *(new)* states `Generated → Needs Review → Approved → Published`
  with version history, side-by-side comparison, and rollback — enabling seller/broker
  collaboration. Backed by the Asset Manager's versions.
- **Distribution Engine** — *(renamed from Publishing Engine)* moves approved Assets out to
  every channel: publish · download · share · send · sync · export → MLS, Zillow, home.com,
  PDF, Email, WhatsApp, social, ZIP, API. It distributes content, not just "publishes."

### 3.3 Why this is stable for 5–10 years

Providers, models, and whole capabilities change without touching the product surface, the
intelligence, the Asset Manager, or the QA/Policy/Approval spine. New capability = register
it on an engine. New provider = one adapter. New output type on the Studio screen = a new
capability wired to an existing engine. The "what do you want to create?" experience is
unchanged.

---

## 4. Technical inventory (audited 2026-07-14) — where the pieces stand today

| Layer / engine | Real today? | Notes |
|---|---|---|
| Media Intelligence (Claude Vision) | **Real** | classify/quality/strategy, 40/40 unit tests; not yet run on real listings in prod; **suppression logic not built yet** |
| Cost Engine | Partial primitive | `providers/cost-table.ts` is a deterministic cost table; no decision component yet |
| Asset Manager | Partial | storage buckets exist; no unified Asset model/versioning |
| Image Engine → Luma | **Real, most mature** | `src/lib/luma.ts` + `/api/staging/generate`, real credits, rate limit, credit system |
| Image Engine → OpenAI / Nano Banana | Not built | future adapters |
| Video Engine → Remotion | **Not installed** | the deterministic renderer for the first real slice |
| Video Engine → Veo | **Partial + defective** | real engine `src/lib/tour/processors/gemini-video.ts`; **treats async Veo as synchronous** (must fix); media-agent `veo.ts` is a stub that throws |
| Tour Engine | **Does not exist** | KIRI removed 2026-06-16; `<TourComingSoon>`; `three.js` declared, zero imports; Modal gsplat POC failed 3×. Open decision → separate spec |
| Media QA Agent | Not built | new |
| Media Policy Engine | Partial primitives | disclosure/badge in legal modules; not an engine |
| Approval Workflow | Mock only | job has a status; no versioned approval states |
| `media_agent_jobs` migration | Authored, **not applied** | P0 |
| Flag `MEDIA_AGENT_ENABLED` | Off everywhere | P0 |

**Test coverage:** all unit/mock. No integration test hits a real provider. Observability
(Sentry/PostHog) absent.

---

## 5. Roadmap — stable architecture, small first slice

The architecture above is the multi-year target. The **implementation plan** builds the
thinnest vertical slice that proves it end to end with a real deliverable — introducing each
new component (Asset Manager, Cost Engine, QA, Policy, Approval) at *thin depth* now, deep
later.

### P0 — Foundation in production
Merge PR #81; apply `media_agent_jobs` migration (owner sign-off); set the flag on Vercel.
Product renamed to "Creative Studio" in UI/docs; code identifiers unchanged (decided).
**Exit:** the stack runs in prod behind the flag with a mock deliverable; a job persists; the
Studio reads its state. Five gates pass.

### P1 — Media Intelligence real, on real listings (incl. "what NOT to generate")
Run classify/quality/strategy on a real listing; produce the Media Strategy **with
suppressions** (readiness gates); harden Claude Vision cost/errors. **Exit:** a real listing
yields a verifiable classification + hero sequence + Media Strategy that also states what it
will *not* make and why.

### P2 — First REAL deliverable: a listing video — **this plan's goal**
- **Video Engine** with the **Remotion** deterministic renderer registered as a capability
  ("Listing video"/"Slideshow"), dispatched by the **Creative Engine** from the Media
  Strategy using the **real listing photos** (Ken Burns, transitions, branding, music) as an
  async render job.
- **Asset Manager (thin):** the output is stored as a versioned **Asset**, not a loose file.
- **Cost Engine (thin):** entitlement check by plan before rendering (deterministic render is
  cheap, but the gate is exercised).
- **Media QA (light):** framing/order sanity.
- **Approval Workflow (first pass):** Generated → Approved → Published.
- **Policy:** disclosure/badge on publish.
- Seller Studio surface: "Create listing video" — no renderer named.
- **Exit:** a real listing produces a downloadable/attachable video with **zero generative
  AI** (no misrepresentation risk), reproducible; Asset/Cost/QA/Approval/Policy all exercised
  at thin depth.

### P3 — Generative capabilities (Image + Video AI) — *documented, not in this plan*
Register generative capabilities: **Image Engine** Luma adapter wired to the Studio (reuse
credits/rate-limit + disclosure); **Video Engine** Veo adapter rewritten to wrap the real
engine with **fixed async handling** (webhook-driven). **Deep, blocking Media QA** for all
generative output; **Cost Engine** value decisions per clip. **Exit:** optional generative
photos/clips gated by cost + QA + review + disclosure; per-job cost measured.

### P4 — Tour Engine (navigable 3D) — separate workstream, open decision
See `2026-07-14-3d-tour-spatial-workstream.md`. Not Veo. Blocked on selecting + validating a
spatial provider.

### Cross-cutting (every phase with real generation)
Async jobs, storage (existing buckets, via the Asset Manager), webhooks, observability
(Sentry/PostHog), cost control (Cost Engine), integration tests per adapter.

---

## 6. Out of scope for THIS plan
- P3 generative wiring beyond documentation.
- The Tour Engine / 3D workstream (separate spec).
- Full breadth of Studio outputs (flyers, campaigns, landing, email, copy…) — the
  architecture accommodates them; the first slice ships one (video).
- A full Asset Manager / Cost Engine / QA / Approval — each ships thin in P2, deep later.
- MCP/skills as production runtime (they remain dev tooling).
- New billing tiers.
