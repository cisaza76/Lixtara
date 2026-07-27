# ADR-0011 — Video color-range normalization in the preparation stage

- **Status:** accepted (2026-07-27)
- **Context:** Gate 5A controlled validation (job `9467cc1f`, listing `b48b6bd9`, 2026-07-27)
- **Related:** ADR-0005 (single-sandbox pipeline), ADR-0007 (source video replacement policy)

## Context — what Gate 5A proved

Gate 5A's single controlled generation FAILED at the preparation stage with
`prepared output failed validation: pixel_format`. The evidence is deliberately preserved
(failed job `9467cc1f`, source asset `594672ba`, quota consumed 1/1): **the strict
post-prepare validator did its job** — it refused to hand Remotion a non-normalized
intermediate. This ADR records why the failure happened and the contract that fixes it.

### Root cause

The Gate 5A source was a JPEG-derived H.264 clip. JPEG is **full-range** ("pc",
luma 0–255); FFmpeg propagates that range through still→video encodes, so the source
stream probes as `yuvj420p / color_range=pc`. The preparation command normalized
geometry/fps and requested `format=yuv420p` + `-pix_fmt yuv420p` — but **neither converts
color range**: swscale treats `yuvj420p` as the same memory layout as `yuv420p`, the
encoder re-signals full range in the H.264 VUI, and the prepared output probes as
`yuvj420p` again. The validator (correctly) rejected it.

This is not synthetic-only: phones and screen recorders can and do emit full-range H.264.
A real seller upload could hit the same wall.

### Measured behavior matrix (ffmpeg/ffprobe 8.1.2, Darwin arm64 — 2026-07-27)

| Input | probe | old prepare output | new prepare output |
|---|---|---|---|
| TV-range (tagged `tv`) | `yuv420p/tv` | `yuv420p` ✔ | `yuv420p` ✔ values untouched (no double conversion — verified 12/230 → 12/231) |
| Full-range (JPEG-derived) | `yuvj420p/pc` | `yuvj420p/pc` ✘ **Gate 5A failure** | `yuv420p/tv` ✔ values remapped (luma 0–255 → ~16–235) |
| Limited values tagged `pc` | `yuvj420p/pc` | `yuvj420p/pc` ✘ | `yuv420p/–` ✔ converted per its tag |
| Untagged | `yuv420p/–` | `yuv420p/–` ✔ | `yuv420p/–` ✔ values untouched |

Reproduce locally with `scripts/generate-video-range-fixtures.sh` (CI never runs FFmpeg;
the unit suites pin this contract against synthetic ffprobe JSON).

## Decision

1. **Real value conversion, centralized.** Both filter graphs (16:9 fit and blurred-fill)
   end in a shared tail: `scale=in_range=auto:out_range=tv,format=yuv420p,setsar=1`.
   The dedicated swscale pass **remaps pixel values** to limited range using the stream's
   own range tag (`in_range=auto`); untagged input is limited per H.264 defaults → no-op.
   **Admitted blind spot (by design):** a source that is untagged yet actually carries
   full-range values is undetectable by any range-tag inspection — it passes through
   unconverted and validates. This is the correct trade-off: every spec-compliant player
   also decodes such a stream as limited, so our output matches how the source already
   rendered everywhere; "fixing" it would require content-based range guessing.
   We explicitly rejected metadata-only retagging (`-color_range tv` alone): on ffmpeg
   8.1.2 it triggers an *implicit*, version-dependent conversion — measured, undocumented,
   and not a contract.
2. **Coherent metadata.** The encoder args also carry `-color_range tv` so the stream tag
   matches the converted values wherever the encoder writes VUI colour data.
3. **Fail-closed validation extended, not weakened.** The prepared-output probe now parses
   `color_range`, and the validator requires `pix_fmt === yuv420p` **and**
   `color_range ∈ { "tv", null }`. `null` is accepted because H.264 defines an unspecified
   range as limited AND x264 only writes the VUI colour block when the input carried
   colour metadata — both decode identically. `pc` (or any other value) is always a
   violation. `yuvj420p` output remains rejected.
4. **Error taxonomy corrected.** `classifyThrown` now maps `VideoPreparationExecutionError`
   by its own code: `VIDEO_PREPARATION_FAILED` (ffmpeg execution) and
   `VIDEO_PREPARED_SOURCE_INVALID` (post-prepare probe/validation), both `non_retriable`
   (same input ⇒ same failure; retries would burn Sandbox attempts on a poisoned input).
   `ASSET_DOWNLOAD_FAILED` is once again exclusively a download failure — Gate 5A's
   failure had surfaced under that code via the stage default, hiding the real cause.
5. **Fingerprint bump.** `PREPARATION_PLAN_SCHEMA_VERSION` 1 → 2: the recipe changed, so
   equivalent sources deliberately no longer share fingerprints with pre-fix plans.

## Operational notes

- **Quota semantics are unchanged and intentional:** a generation slot is consumed when
  the job is created, not when the render succeeds. A failed job does NOT refund quota;
  re-running requires an operator decision (revoke + re-grant, per the Gate 5 protocol).
- Gate 5A stays recorded as FAILED. The failed job/source rows are evidence, not garbage.
- Source-upload acceptance is unchanged: full-range uploads are legal input; the
  pipeline now owns making them conform.
