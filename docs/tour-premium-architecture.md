# Tour Premium — future architecture

Status: **design / prep** (engine undecided). Owner sign-off needed before
building. This document is the blueprint so the build is a plug-in, not a
rewrite. See the `gaussian-splatting-decision` memory for the vendor saga.

## Goal / non-goals

**Goal:** let a seller record a phone walkthrough and get a **premium tour**
(interactive 3D Gaussian-Splatting scene OR a polished guided video) embedded on
their public listing, without us hand-holding each one.

**Non-goals (for now):** building our own 3DGS trainer from scratch; real-time
capture; live-streamed tours. The engine is a swappable dependency, never the
core.

## Current state (what already exists)

| Piece | State |
|---|---|
| Seller coaching UI (`tour-coaching.tsx`) | ✅ shipped (PR #56) — "in preparation", how-to-record guide, disabled CTA, no upload |
| Public placeholder (`tour-coming-soon.tsx`) | ✅ shipped — premium "coming soon" card on the listing |
| `tour_jobs` table | ✅ exists (status, property_id, storage paths) — currently unused |
| `tour-videos` / `tour-models` storage buckets | ✅ exist |
| Capture engine | ❌ undecided (KIRI removed — quality ceiling). No upload wired. |
| Web viewer | ❌ removed with KIRI (`gsplat` dep dropped) |

So the **shell is done**; what's missing is (1) upload, (2) a processor, (3) a
viewer — and the decision of which processor.

## Pipeline (vendor-neutral)

```
Seller records video
      │  (coaching UI already guides this)
      ▼
[1] Upload  → Supabase Storage  tour-videos/{property_id}/{uuid}.mp4
      │      + insert tour_jobs row { status: "uploaded" }
      ▼
[2] Enqueue → POST to the chosen TourProcessor (async). status: "processing"
      │
      ▼
[3] Process (GPU, off our servers) → 3DGS .ply (+ cameras.json) OR rendered video
      │
      ▼
[4] Callback → processor webhooks us → upload output to tour-models/, 
      │        tour_jobs.status = "ready" (or "failed"), email the seller
      ▼
[5] Serve   → listing page swaps the placeholder for the viewer
              (gsplat web component for 3DGS, or <video> for guided video)
```

Every box already has its data home (`tour_jobs`, the two buckets). Only [2]/[3]
are new and vendor-specific.

## The swappable abstraction (build this first)

Define one interface; every engine implements it. Swapping Replicate → Modal →
video is then a one-file change, not a refactor.

```ts
// src/lib/tour/processor.ts  (to build)
export type TourKind = "gaussian_splat" | "video";

export interface TourJobInput {
  jobId: string;          // our tour_jobs.id
  propertyId: string;
  videoUrl: string;       // signed URL to the uploaded walkthrough
  callbackUrl: string;    // our webhook to receive the result
}

export interface TourProcessor {
  readonly kind: TourKind;
  /** Kick off async processing. Returns the vendor job id we persist. */
  start(input: TourJobInput): Promise<{ vendorJobId: string }>;
  /** Parse a vendor callback into a normalized result. */
  parseCallback(body: unknown): {
    vendorJobId: string;
    status: "ready" | "failed";
    outputUrl?: string;   // .ply/zip or rendered mp4
    error?: string;
  };
}
```

The route handlers (`/api/tours/submit`, `/api/webhooks/tour`) depend only on
`TourProcessor`, selected by an env var `TOUR_ENGINE`.

## Engine options

| Option | Integration | Quality ceiling | Cost | Risk |
|---|---|---|---|---|
| **Replicate (hosted gsplat)** | Lowest — HTTP + webhook, no infra | High (true 3DGS) | ~$2–5/scene, pay-per-use | Vendor dependency; cold starts |
| **Self-host gsplat on Modal** | High — own GPU image + trainer | Highest (full control) | ~$3–8/scene + eng time | Image-build tar pit (3 failed POCs) → use the **pre-built nerfstudio image** |
| **Guided / 360° video** | Low — transcode + player | N/A (not 3D) | Cheap | Not "3D"; least wow but deliverable now |

**Recommendation:** start with **Replicate** behind the `TourProcessor`
interface — fastest path to validate real quality with zero infra. Keep the
**Modal pre-built-image** path as the fallback if cost/control demands it. Offer
**guided video** as an interim "premium video tour" tier so sellers get value
before 3DGS is locked. **Always validate quality with a vendor-neutral `.ply` in
superSplat before integrating** (the lesson from the KIRI/Luma cycles).

## Phased rollout

- **Phase A — upload (no engine):** re-enable video upload to `tour-videos` +
  `tour_jobs` row `status="uploaded"`. Seller sees "received, in preparation".
  Swap the disabled CTA in `tour-coaching.tsx` for a real upload. *Low risk;
  ships value immediately (we collect material).*
- **Phase B — processor:** implement one `TourProcessor` (Replicate) +
  `/api/tours/submit` (enqueue) + `/api/webhooks/tour` (receive result, flip
  status, email). Quality-gate behind a feature flag / allowlist.
- **Phase C — viewer:** re-add a 3DGS web viewer (gsplat) or the video player;
  the listing page renders it when `tour_jobs.status="ready"`, else the
  placeholder.
- **Phase D — productize:** gate on Pro/Concierge, set pricing, add an AI
  room-by-room description for WCAG (3DGS is opaque to screen readers), and
  confirm the MLS photo-manipulation policy (Stellar/Miami Realtors) — disclaimer
  badge like the AI-staging one.

## Open decisions (owner)

1. Engine: Replicate vs Modal vs guided-video (or video-now / 3DGS-later).
2. Pricing & gating (included in a tier? add-on like photography/staging?).
3. Accessibility: AI description for 3DGS scenes (WCAG).
4. MLS compliance: is a 3DGS scene a "photo" or a "virtual tour"? disclaimer?

## Why this is "prep, not build"

The interface + data model + buckets mean Phase A–C are isolated, testable
units. We do **not** commit to a vendor today; we commit to the *shape* so the
vendor choice is a config + one adapter file. Until then, the shipped coaching
placeholder is the honest user-facing state.
