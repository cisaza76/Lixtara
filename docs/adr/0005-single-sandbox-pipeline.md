# ADR-005 — Single-Sandbox Video Pipeline (deferred)

- **Status:** Accepted (records current state + future target) — 2026-07-23
- **Scope:** the `uploaded_video` integration pipeline (`src/lib/video-engine/uploaded-video-pipeline.ts`).
- **Related:** ADR-0001 (generic property video pipeline); F3-A Steps 3–5.

## Context

The `uploaded_video` branch prepares a seller-uploaded clip (FFmpeg normalization) and then
renders it through the shared `ListingVideo` composition. Preparation needs a sandbox (FFmpeg +
ffprobe); rendering needs a sandbox (Chromium + Remotion + `@remotion/media`). Today these are
**two separate sandboxes**, bridged by an ephemeral host temp file.

## Current state (two sandboxes)

```
prepare sandbox                          render sandbox
  download source                          stage prepared-0.mp4 (from host temp)
  → ffprobe source                         → install @remotion/media
  → planVideoPreparation (pure)            → bundle
  → executeVideoPreparation (ffmpeg)       → selectComposition("ListingVideo")
  → read prepared bytes  ──► host temp ──► → renderMedia
  → stop() + rm workspace                  → ffprobe QA
                                           → stop()
```

- The prepared clip lives ONLY in the prepare sandbox and, briefly, as an ephemeral host temp
  (`/tmp/video-prepared-*/prepared-0.mp4`), cleaned in a `finally` on success AND every failure.
- It is **never** persisted to Storage (only the final render output is).

## Future target (single sandbox)

```
single sandbox
  download source
  → ffprobe source → planVideoPreparation → executeVideoPreparation (ffmpeg)   [prepare]
  → prepared file stays in-sandbox (no host round-trip)                        [handoff]
  → install @remotion/media → bundle → renderMedia → ffprobe QA               [render]
  → stop() (workspace dies with it)                                           [cleanup]
```

The prepared file would be handed directly from preparation to the render bundle's `public/`
dir **inside the same sandbox**, eliminating the host round-trip and one sandbox startup.

## Why we do NOT do this today

1. **Reuse over restructure.** The two-sandbox design reuses the *already-approved, hardened*
   `executeVideoPreparation` (its own sandbox port) and `SandboxRemotionProvider` (its own
   sandbox lifecycle, font guard, staging, QA) **unchanged**. A single-sandbox design requires
   restructuring `SandboxRemotionProvider` to accept a pre-existing in-sandbox prepared file and
   to run inside a sandbox it did not create — a change to a validated render path.
2. **Layer boundary (gate constraint).** F3-A Step 5 explicitly forbade moving preparation/FFmpeg
   logic into the render provider ("No mover lógica de preparación aquí"). A single sandbox would
   need the render provider (or a new coordinator) to own both phases, blurring that boundary.
3. **Cost is bounded + acceptable.** The extra cost is one sandbox startup (~10–20 s) + a host
   read/write of the prepared bytes (≤ the 300 MB source cap, in practice much less). For a 60 s
   MVP clip whose render already runs minutes, this is a small fraction of wall-clock.
4. **Correctness is unaffected.** Cleanup + "prepared never persisted" hold identically in both
   designs; the host temp is ephemeral and `finally`-cleaned.

## Consequences / trigger to revisit

- The single-sandbox optimization becomes worthwhile if: sandbox startup dominates wall-clock at
  scale, the host round-trip becomes a memory/disk pressure point, or the render provider is
  refactored anyway to accept a staged source. At that point, prefer a single coordinator that
  owns one sandbox and calls the (unchanged) pure preparation + render steps within it.
- Until then: **no implementation change.** This ADR records the deferral so the two-sandbox
  design is a documented, deliberate choice — not an oversight.
