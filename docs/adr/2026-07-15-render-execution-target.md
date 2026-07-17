# ADR-0001 — Render Execution Target for the Video Engine

**Status:** ACCEPTED (ratified by owner 2026-07-15) — governs the next several years
**Date:** 2026-07-15
**Deciders:** Camilo Isaza (owner) + Claude
**Context doc:** `docs/superpowers/specs/2026-07-14-lixtara-creative-studio-architecture.md`
**Blocks:** P2 (the first real deliverable — a deterministic listing video via the Video
Engine's Remotion renderer). **Do not start Remotion implementation until this ADR is
ratified.**

---

## 1. Context

The Video Engine's first renderer is Remotion (deterministic, real-photo listing videos).
Remotion rendering needs a **headless Chromium + FFmpeg** environment (~150 MB), CPU, RAM,
and scratch disk — it cannot run inside a normal request handler. **Where that render
executes is an infrastructure decision independent of the product architecture**, and it
drives cost, latency, concurrency, ops burden, and provider lock-in for years. This ADR
selects that execution target.

Lixtara-specific facts that shape the decision:
- The app is deployed on **Vercel** (Fluid Compute). CLAUDE.md prefers **platform-native
  infrastructure before custom infra**, and warns against adding external infra unnecessarily.
- Expected early volume is **low** (FSBO listings in Florida), and the deliverable is a
  **short listing reel** (tens of seconds), not feature-length video. Distributed,
  massively-parallel rendering is not required to hit acceptable latency at this scale.
- We already use / can use **Vercel Blob** for output storage.
- The team is one owner + Claude; **operational simplicity has high weight**.

## 2. Hard constraint (rules out the "obvious" option)

**Vercel Serverless Functions cannot render Remotion.** The function bundle cap is 50 MB;
Chromium + FFmpeg alone is ~150 MB. Remotion's own docs confirm this and recommend triggering
a separate render environment from a Vercel function. So the Vercel *function* orchestrates;
it never renders.

## 3. Options considered

| Option | Renders Remotion? | Model | Notes |
|---|---|---|---|
| **A. Vercel Sandbox** | yes | single-machine VM, Vercel-native (GA Jan 2026) | Easiest setup (Vercel account + a Blob store). Pay for VM run time. |
| **B. Remotion Lambda (AWS)** | yes | distributed (3–200 lambdas/render), fastest | Highest-volume Remotion users pick this. Requires an AWS account + IAM/role setup. |
| **C. Cloud Run (GCP)** | yes | single-machine container | Cheaper than Lambda; **Alpha** in Remotion; Docker-image-per-change slows iteration; GCP dependency. |
| **D. Self-hosted worker (Modal/Fly/Railway/container)** | yes | single-machine, full control | Most operational burden; a prior self-host attempt (Modal, for 3D gsplat) failed 3× on image build — cautionary. |
| ~~E. Vercel Serverless Function~~ | no | — | Ruled out by §2 (50 MB cap). |

## 4. Decision criteria (owner's list) → comparison

Legend: **`+`** favorable · **`~`** neutral · **`-`** unfavorable — directional, for
**Lixtara's** context (low volume, short videos, Vercel-hosted, tiny team), not in the abstract.

| Criterion | A. Vercel Sandbox | B. Remotion Lambda | C. Cloud Run | D. Self-host |
|---|---|---|---|---|
| **Cost per render** | `~` pay per VM run-time | `-` distributed overhead, priciest | `+` cheapest (no idle) | `+` cheap if used / `-` if idle |
| **Max render time** | `+` 45 min Hobby / **5 h Pro** | `~` ~120 s/lambda but parallelized | `+` long | `+` unbounded |
| **Cold start** | `~` VM spin-up per render | `+` warm-ish, parallel | `-` container cold start | `-` depends |
| **Concurrency** | `+` 10 Hobby / **2000 Pro** | `+` 3–200/render, 1000/region | `~` configurable | `~` self-managed |
| **Storage / output** | `+` Vercel Blob native | `~` S3 (5 GB output cap) | `~` GCS | `~` bring your own |
| **Observability** | `+` Vercel logs, one platform | `-` CloudWatch, 2nd platform | `-` GCP logging | `-` build it |
| **Queues** | `~` pair with Vercel Queues (beta) | `~` SQS / self | `~` Pub/Sub | `~` self |
| **Cancellation** | `~` stop the VM | `~` per-render API | `~` kill container | `~` self |
| **Retries** | `~` orchestrator-driven | `+` per-chunk retry built in | `~` self | `~` self |
| **Ops ease** | `+` **easiest**, one platform | `-` AWS account + IAM | `-` GCP + Docker pipeline | `-` highest burden |
| **Provider lock-in** | `-` Vercel (already all-in) | `-` AWS (new dependency) | `-` GCP (new dependency) | `+` portable |

## 5. Decision

**Adopt Option A — Vercel Sandbox — as the render execution target**, with **Remotion Lambda
(Option B) documented as the escape hatch** if volume or latency ever outgrows single-machine
rendering.

Rationale:
- It keeps the entire stack **Vercel-native** (no new cloud account, no AWS/GCP IAM), matching
  CLAUDE.md's "platform-native before custom infra" rule and minimizing ops for a tiny team.
- Its limits are **comfortably above our needs**: 5 h timeout and 2000 concurrency on Pro vastly
  exceed short listing reels at low volume. Lambda's distributed-rendering advantage solves a
  problem **we do not have** (feature-length video / high throughput), while adding AWS.
- **Storage and observability stay on one platform** (Vercel Blob + Vercel logs).
- The escape hatch is real and cheap: a Vercel function already orchestrates the render, so
  swapping the Sandbox call for a Remotion-Lambda trigger later is an **adapter change inside
  the Video Engine**, not a product change (exactly what the capability/adapter architecture is
  for).

**Not chosen:** Lambda (overkill + AWS dependency now), Cloud Run (Alpha in Remotion, Docker
friction, GCP dependency), self-host (highest ops burden; prior Modal self-host attempt failed).

## 6. Consequences

- **Positive:** minimal new infra; one billing/observability surface; generous headroom;
  reversible via an adapter.
- **Negative / to accept:** single-machine rendering (no distributed speed-up) — fine for short
  reels; a per-render VM cold start (seconds) — fine for an async job; deeper Vercel lock-in
  (already the case).
- **Concrete triggers to migrate to Lambda (any one is sufficient):**
  1. median render duration exceeds the product SLA threshold on a single machine;
  2. sustained concurrency exceeds our operational capacity on Sandbox;
  3. measured cost-per-video on Sandbox exceeds the Lambda equivalent;
  4. a genuine need for **distributed, per-frame** rendering appears (long/complex video);
  5. repeated render failures or timeouts on Sandbox;
  6. monthly render volume grows enough to justify the AWS complexity.
  Lambda stays a **formal escape hatch behind the Video Engine adapter — not a parallel
  implementation.** We do not build it until a trigger fires.
- **Follow-on work unblocked once ratified:** the P2 plan is written against Vercel Sandbox — a
  Vercel function enqueues a Creative Job, the Sandbox renders with `@remotion/renderer`, output
  lands in Vercel Blob as a versioned **Asset**, and the job lifecycle is observable (see the
  Creative Jobs observability spec).

## 7. Ratified decisions (owner, 2026-07-15)

1. **Plan tier — build for Vercel Pro.** Production assumes Pro (5 h / 2000). Hobby is for
   limited local dev only and must **not** shape production architecture. The system must
   degrade gracefully locally/CI: lower-resolution renders, single concurrency, short fixtures,
   and an option to skip the heavy render in CI. Do not add architecture just to fit Hobby.
2. **Storage — Supabase Storage is the single source of truth for P2** (both source assets and
   renders). Vercel Sandbox may use *temporary* storage during the render, but the final MP4
   must be uploaded to Supabase and registered as an Asset **before the job is considered
   complete**; the temp file is then deleted. **Vercel Blob is NOT introduced yet** — it may be
   evaluated later only if it shows a measurable advantage in egress / CDN / direct upload /
   latency / cost / stability. See the Asset Manager spec.
3. **Queue — start synchronous** (function → Sandbox render → upload to Supabase → Asset), add
   Vercel Queues only when throughput needs it.

## 8. Evidence — validated by Spike P2.0 (2026-07-15)

Full report: `docs/superpowers/spikes/2026-07-15-p2.0-sandbox-render.md`. **Verdict: PASS.**

- **Real render confirmed** on Vercel Sandbox — region **`iad1`**, runtime **Node 24**,
  **4 vCPU / 8 GB**. 3/3 renders valid, ffprobe-verified (**H.264 · 1280×720 · 30 fps · 13.056 s**).
- **Reference render time:** `renderMedia` ~**13.4 s** (stable); total per-render wall ~**15–18 s**;
  bundle cache 3.5 s → 1.1 s; sandbox create ~0.4 s.
- **Exact versions used:** `remotion` / `@remotion/bundler` / `@remotion/renderer` = **4.0.489**,
  `@vercel/sandbox` = **2.6.1**, `react`/`react-dom` = 18.3.1.
- **Prebuilt artifact is MANDATORY** (not optional): one-time prep was ~38 s + ~362 MB ingress
  (npm install + Chromium + OS libs + ffmpeg). Production bakes this into a versioned base so
  per-job cost is render-only (~cents/video active-CPU; confirm the current Sandbox rate).
- **Mandatory base dependencies:** Chromium **+ its OS libraries** (Amazon Linux 2023 lacks
  mesa-libgbm/nss/…), **ffmpeg**, **ffprobe**, **`xz`/`tar`** (static ffmpeg unpack), and the
  **pinned** Remotion packages.
- **Run in-sandbox commands via a shell** (`sh -c "…"`) — a missing binary through direct
  `runCommand` yields an opaque `400`; via `sh -c` you get a clean exit code (127) to handle.
- Failure/timeout/retrieval paths and `sandbox.stop()` cleanup all validated.
- Checksums across renders differ (H.264 metadata) — acceptable: required reproducibility is
  **functional/visual**, not bit-identical.

### ADR-reopen criteria (revisit Sandbox → Lambda/dedicated worker) if:
median render latency, per-video cost, or plan concurrency/limits change materially against the
§5 triggers; or a need for distributed per-frame rendering appears. Until then, Sandbox stands.

---

Sources: [Remotion — compare SSR options](https://www.remotion.dev/docs/compare-ssr),
[Remotion on Vercel Sandbox](https://www.remotion.dev/docs/vercel-sandbox),
[Remotion — Vercel Serverless functions (why not)](https://www.remotion.dev/docs/miscellaneous/vercel-functions),
[Remotion Lambda limits](https://www.remotion.dev/docs/lambda/limits),
[Vercel Sandbox pricing & limits](https://vercel.com/docs/sandbox/pricing).
