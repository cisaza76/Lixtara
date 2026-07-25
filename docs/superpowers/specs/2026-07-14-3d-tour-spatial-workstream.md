# Tour Engine (navigable 3D) — spatial reconstruction workstream (OPEN DECISION)

**Status:** Open technical decision — provider NOT selected. This is a scoping + validation
spec, not an implementation plan.
**Date:** 2026-07-14
**Author:** Camilo Isaza + Claude
**Relationship:** the **Tour Engine** capability of the Lixtara Creative Studio
architecture (`2026-07-14-lixtara-creative-studio-architecture.md`). Like every other
engine it hides its provider behind an adapter — but unlike Image/Video, **no adapter can
be written yet because no provider is chosen**. Kept separate so it never blocks the Studio
slices (P0–P3).

---

## 1. The gap (explicit)

The public product implies a **navigable 3D tour**. The repo does **not** deliver one today:

- KIRI removed 2026-06-16 (`chore/remove-kiri-3d`) — its output quality was unusable
  (blurry `.ply`, ~358k gaussian ceiling from the public API, no quality knob).
- The property page shows `<TourComingSoon>` ("Coming soon / Muy pronto"), not a tour.
- `three.js` is a declared dependency with **zero imports** — no viewer is wired.
- A self-host gsplat POC on Modal **failed 3× at image build** (pre-GPU, $0 compute). The
  replacement 3DGS pipeline is still "being chosen."
- Preserved for reuse: `tour-coaching.tsx` (guided-capture coaching), `tour_jobs` table,
  `tour-videos`/`tour-models` buckets.

**A generative video model (Veo) is not a substitute.** Veo makes a moving clip from a
photo; it does not reconstruct navigable 3D space. The published promise requires spatial
reconstruction + hosting + a browser viewer.

---

## 2. Target pipeline (once a provider is chosen)

```
Guided phone walkthrough  (reuse tour-coaching.tsx)
          ↓
Capture-quality validation  (duration/resolution preflight already exists)
          ↓
Dedicated spatial-reconstruction provider   ← OPEN DECISION
          ↓
3D processing & hosting  (buckets exist; hosting/CDN TBD)
          ↓
Seller review
          ↓
Browser-based navigable viewer  (three.js present but unused → to wire)
          ↓
Listing integration  (replace <TourComingSoon> on the property page)
```

## 3. Provider options on the table (to validate, not yet chosen)

1. **Self-host gsplat / nerfstudio on Modal (or RunPod)** — full quality control; POC
   failed 3× on the image build (torch build-isolation). Highest control, highest ops burden.
2. **Hosted reconstruction endpoint (e.g. Replicate)** — less ops; quality + cost + terms
   to validate; API maturity to confirm.
3. **Pivot to a simpler tour** — 360° panoramas or a polished guided-video tour instead of
   true 3DGS. Lower promise, but shippable and honest.

## 4. Decision gate (do this BEFORE any implementation)

Produce a **fidelity validation** on a real interior capture before committing:
- Run each candidate on the same real walkthrough; compare output quality in a
  vendor-neutral viewer.
- Record: reconstruction quality, per-scene cost, turnaround time, API maturity, hosting
  model, commercial terms/licensing.
- Confirm what credentials/limits/webhooks each requires.
- **Exit of the gate:** one provider selected *with evidence*, or an explicit decision to
  pivot to 360°/guided-video. Only then does this workstream get an implementation plan.

## 5. Compliance note

The reconstruction must not misrepresent the property. Any 3D output inherits the same
disclosure discipline as the Living Listing / virtual staging (labeled, non-deceptive).

## 6. How it plugs into the Studio (once validated)
The Tour Engine sits beside the Image and Video Engines under the **Creative Engine**, and
like them exposes its capabilities (Navigable 3D · 360° · Guided-video) behind provider
adapters. The **Cost Engine** gates it hard by plan entitlement (a 3D tour is an expensive
capability — likely Concierge-only). Its output is stored as a versioned **Asset** in the
Asset Manager and flows through the same **Media QA Agent** (does the reconstruction distort
the space?), **Media Policy Engine** (disclosure / AI badge), and **Approval Workflow**
(Generated→Review→Approved→Published) as every other capability. The seller-facing Studio
exposes "3D tour" as one more content type — the spatial provider stays invisible.

## 7. Non-goals here
- No provider is selected in this document.
- No viewer/hosting is designed until the decision gate passes.
- This workstream must not block the Studio slices (P0–P3).
