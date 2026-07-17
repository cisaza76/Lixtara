# Creative Jobs — lifecycle & observability design spec

**Status:** Design under review
**Date:** 2026-07-15
**Author:** Camilo Isaza + Claude
**Part of:** the Lixtara Creative Studio architecture
(`2026-07-14-lixtara-creative-studio-architecture.md`).
**Ordering:** decision #4 of the pre-P2 architectural closures. The **job lifecycle + its
transition telemetry must be designed before P2** so the first real render is observable from
day one, not instrumented after the fact.

---

## 1. Why observability is designed, not added later

A Creative Job spends most of its life **outside a request** — queued, rendering in a Sandbox,
uploading, under QA. When something is slow, fails, or costs too much, the only way to answer
"why" is a durable, queryable history of what happened and when. Building that history from the
start turns support and optimization from guesswork into data. This is a **design requirement**,
not a nice-to-have.

## 2. Three state machines, not one (owner decision 2026-07-15)

A single machine must not try to represent three different domains — a technical render, human
approval, and publication. They move on different clocks (a render finishes in seconds; approval
can wait days; distribution hits several destinations). So they are **separate, linked** machines.

### 2.1 Creative Job (technical render lifecycle)

```
queued → running → rendering → uploading → qa → completed
   │        │          │           │        │
   └────────┴──────────┴───────────┴────────┴──▶ failed     (an active state errored)
   └──────────────────────────────────────────▶ cancelled  (user/admin cancelled)
```

| State | Meaning |
|---|---|
| `queued` | Accepted, waiting for a render slot (Cost Engine said go; entitlement passed). |
| `running` | Picked up; inputs (Assets) resolved via the Asset Manager. |
| `rendering` | The engine/provider produces bytes (Remotion in a Vercel Sandbox). |
| `uploading` | Output bytes are written to Supabase Storage as a new Asset. |
| `qa` | Media QA Agent checks fidelity (technical/light for deterministic output). |
| `completed` | The render Asset exists and passed technical QA. **The job ends here.** |
| `failed` | An active state errored (reason + retry accounting). |
| `cancelled` | User/admin cancelled; the render (Sandbox VM) is stopped. |

The Creative Job **does not** own approval or publication. It ends at `completed`, having
produced an Asset in lifecycle `ready_for_review`.

### 2.2 Asset Lifecycle (human review, per the Asset Manager spec)

```
draft → ready_for_review → approved | rejected → archived
```

Begins when the job completes (`ready_for_review`). `approved`/`rejected` are human/Policy
decisions; a rejected Asset can spawn a new version. This is where a video can sit for days.

### 2.3 Distribution (publication, later phase)

```
pending → publishing → published | failed → removed
```

Owned by the Distribution Engine. **Not in P2** — P2 stops at a reviewable, downloadable Asset;
no automatic publication.

Transitions in every machine are **explicit and logged** — no silent jumps. The Asset is written
during the job's `uploading` state; QA/approval verdicts attach to that Asset version.

## 3. Every transition is a telemetry event

On each state change, append one **immutable** event with the owner's required fields:

```ts
type JobTransition = {
  jobId: string;
  listingId: string;
  userId: string;           // who owns/triggered the job
  from: JobState;
  to: JobState;
  at: string;               // ISO timestamp (stamped by the writer)
  durationMs: number;       // time spent in `from` before this transition
  cost?: { amountUsd: number; provider: string };  // cost incurred in the state just left (e.g. render)
  provider?: string;        // internal engine/provider active in that state (never surfaced to users)
  capability?: MediaCapability;
  error?: { code: string; message: string };       // present only on → failed
  attempt: number;          // retry counter for the state just left
};
```

- **duration** per state → find the slow stage (render vs upload vs QA).
- **cost + provider** per state → per-job and per-provider economics; feeds the Cost Engine's
  learning loop and finance reporting.
- **errors + attempt** → reliability: which stage fails, how often, and whether retries recover.
- **user + listing** → support ("why is this seller's video stuck?") and per-listing history.

The transition log is **append-only** (like Assets and disclaimer acceptances elsewhere in the
repo) — the source of truth for "what happened," reconstructable months later.

## 4. Retries & cancellation (first-class, from the log)

- **Retry:** a retried state increments `attempt` and appends a new transition; the history shows
  the full retry chain, not just the final outcome. Bound retries per state (config), then → `failed`.
- **Cancellation:** a user/admin cancel appends a transition to a terminal `cancelled` state (add
  to the enum) with who + when; the render (e.g. Sandbox VM) is stopped by the orchestrator.
- **No silent caps:** if a job is dropped, sampled, or truncated, that is a logged transition with
  a reason — never an unlogged disappearance.

## 5. Surfaces

- **Seller (product):** a friendly status only — "Preparing your video…", "Ready to review",
  "Published" — mapped from job state, **never** raw states/providers/internal terms (same rule
  as the readiness UI).
- **Admin/support:** the full transition timeline per job — states, durations, costs, provider,
  errors, retries — for debugging and optimization.
- **Aggregate (owner decision 2026-07-15):**
  - **DB append-only event log — the operational source of truth** (what happened to the job,
    final state, duration, which attempt failed, which Asset it produced, cost). Mandatory.
  - **Sentry — from P2** for exceptions, stack traces, and alerting (what threw, where, is it
    recurring, does it affect prod). This closes part of the go-live analytics gap.
  - **PostHog — deferred** until there is a real, usable Creative Studio flow and product
    events worth measuring (which capability sellers pick, where they drop, approve/regenerate
    rates, time-to-complete). P2 is production infrastructure, not a mature product-analytics
    surface.
  DB answers "what happened to the job"; Sentry answers "what exception, where, how often";
  PostHog will later answer "how sellers behave."

## 6. Persistence & relationship to existing code

- Extend, don't reinvent: the existing `media_agent_jobs` (and `tour_jobs`) already hold a job
  row + status. Add a **`job_transitions`** append-only table keyed by job id for the timeline;
  keep the current status column as the denormalized "current state" for fast reads.
- RLS owner-gated by `userId`/`listingId`; admin reads via the service client (existing pattern).
- **No autonomous schema change** — the migration is authored + owner-applied, and **idempotent**
  (the standard we set).

## 7. Scope for the first slice (with P2)

- P2 uses the **Creative Job** machine through `completed` only: `queued → running → rendering →
  uploading → qa(light) → completed` (+ `failed`/`cancelled`). It produces an Asset in lifecycle
  `ready_for_review`. **No `approved`/`published` in the job machine; no Distribution machine** —
  P2 ends at a reviewable, manually-downloadable Asset.
- Log a transition on **every** change with `durationMs`, `cost`, `provider: "remotion"`,
  `attempt`, and `error` on failure.
- **DB event log + Sentry** ship in P2; PostHog is deferred.
- Seller sees friendly status; the admin timeline can deepen with P3.

## 8. Resolved decisions (owner, 2026-07-15)
1. **Analytics sink — DB log (source of truth) + Sentry in P2; PostHog deferred** (§5).
2. **`cost` capture for Sandbox — attribute Vercel Sandbox VM run-time** to the job at the
   `rendering → uploading` transition when a per-run figure is available; until then record the
   deterministic render as `cost: 0` (the Sandbox VM time is the only real cost).
3. **Cancellation — `cancelled` is a distinct terminal state** in the Creative Job machine (not
   folded into `failed`).
