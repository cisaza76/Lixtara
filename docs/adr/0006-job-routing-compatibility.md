# ADR-0006 — `autoRouteStrategy`: a backward-compatibility seam, not a second mode

- **Status:** Accepted — 2026-07-23
- **Scope:** F4.2 Job Routing (`src/lib/video-engine/job-routing.ts`, `worker-deps.ts`).
- **Related:** ADR-0001 (generic property video pipeline); F3-A Contract Freeze; F3-A Step 5.

## Context

F4.2 makes the video job's Source Strategy an automatic, per-listing, backend-only decision:
a valid seller-uploaded Source Asset routes to `uploaded_video`, otherwise to `photo_slideshow`
(`decideSourceStrategy`, reusing F3's `resolveVideoSource` unchanged).

The natural way to express this would be: "if no explicit strategy is set, decide automatically."
But F3 froze `buildRealProduce`'s dispatch and its tests, where an **absent** `sourceStrategy`
(`undefined`) means exactly `photo_slideshow`:

- `worker-deps.uploaded-video.test.ts` seeds `sourceStrategy: undefined` **and** a
  `resolveVideoSource` that returns a video, and asserts the **photo** path runs (no preparation).
- The F3 flag tests assert `sourceStrategy: "uploaded_video"` + flag OFF → photo, flag ON → uploaded.

Overloading `undefined` to mean "auto-decide" would have changed that frozen behavior (the seeded
resolver would have flipped that test to `uploaded_video`) — a Contract-Freeze violation.

## Decision

Introduce a **separate, additive flag `autoRouteStrategy`** that gates whether the automatic
decision runs, leaving the meaning of `sourceStrategy` (`undefined | "photo_slideshow" |
"uploaded_video"`) exactly as F3 froze it:

```
strategy =
  deps.sourceStrategy                                  // explicit: forced (flag-OFF lock, tests, ops)
  ?? (deps.autoRouteStrategy
        ? await decideSourceStrategy(resolveVideoSource, listingId, ownerId)  // auto
        : "photo_slideshow")                           // F3 default: absent ⇒ photo_slideshow
```

`buildRealWorkerDeps` sets `autoRouteStrategy = true` **only** when the feature flag is ON and no
explicit override was given; otherwise it is absent/false. Consequences:

- Flag OFF → forced `photo_slideshow` (byte-identical to today).
- Flag ON + explicit override → forced (tests/ops).
- Flag ON + no override → auto-route.
- Frozen F3 tests (which set `sourceStrategy: undefined` and never set `autoRouteStrategy`) keep
  resolving to `photo_slideshow`, unchanged.

## Explicit clarifications (the point of this ADR)

1. **`autoRouteStrategy` exists solely for backward compatibility** with F3's frozen tests and the
   frozen `undefined ⇒ photo_slideshow` dispatch contract. It is a compatibility seam, nothing more.
2. **It is NOT a second functional mode of the system.** There are not "manual" and "automatic"
   product behaviors — production always runs with the flag ON and no override, i.e. always
   auto-routes. The flag-OFF and explicit-override paths are an operational kill-switch and a
   test/ops affordance, not user-facing modes.
3. **Strategy selection keeps a single conceptual responsibility:** "pick the strategy for this
   listing from whether a valid Source Asset exists." `decideSourceStrategy` is that one
   responsibility; `autoRouteStrategy` only guards *when* it is consulted, and `sourceStrategy` only
   *overrides* it. The decision itself is not split across mechanisms.
4. **Convergence target.** Once the historical-compatibility need disappears — i.e. when F3's frozen
   tests can be updated to express "auto-route by default" directly — the system should collapse to a
   **single selection mechanism**: `sourceStrategy` becomes purely an optional forced override, the
   default IS the automatic decision, and `autoRouteStrategy` is removed. That is a deliberate future
   simplification, gated on unfreezing the relevant F3 tests, and out of scope now.

## Consequences

- No second pipeline, no duplicated routing logic, `resolveVideoSource` untouched (ADR-0001 / Freeze
  hold).
- One extra boolean on the worker deps, documented here as temporary. It carries no product meaning
  and must not grow into one.
- When the convergence above is done, delete this seam and this ADR's "target" becomes the design.
