# F1-R — Creative Studio v1: Release Hardening & Production Readiness

**Executive audit — 2026-07-22 · main `0f6c582` · audit only (no code/PR/deploy/Production changes).**

Creative Studio v1 (listing-video generator) is **functionally closed** and validated end-to-end
in Preview: a real 10-photo listing renders a valid, correctly-typeset MP4 with gapless
crossfades. This document converts that state into a production-readiness assessment: current
state, open risks, technical debt (P0/P1/P2), and a prioritized Phase-2 roadmap.

---

## 0. Executive summary

- **What works:** the full pipeline — `POST /generate` (flag-gated, auth, rate-limited, ownership,
  readiness) → durable job (`queued→running→rendering→qa→uploading→completed`) → Vercel Sandbox +
  Remotion render → in-sandbox ffprobe QA → Storage upload + read-verify → linked video Asset →
  signed URL. Fonts are OS-level system fonts in the base artifact; a fail-closed guard makes
  code↔snapshot incompatibility impossible to render silently.
- **Maturity:** build-clean, 367 unit tests green, secrets-free manifests, immutable versioned base
  artifact with rollback. Wired **Preview-only**; **Production is fail-closed** (no flag / no
  snapshot var / no CRON_SECRET).
- **Top risks (detail below):** (1) **no route/integration tests** for generate/worker/status;
  (2) **worker only runs via cron on Production** — Preview has no automatic worker (jobs sit
  queued unless triggered); (3) **no error monitoring** live (SENTRY_DSN unset); (4) the render is
  a **synchronous, unbounded-cost** step with no peak-memory instrumentation; (5) leftover
  **30-day auto-snapshots** from validation runs.
- **Recommendation:** before Phase 2, close the P0 items (route/integration tests + worker-on-Preview
  strategy + Sentry). Then build **Video Tour Upload** first — it reuses this exact pipeline and is
  the highest-value, lowest-new-infra capability.

---

## 1. Technical audit (inventory only — no behavior change)

Scope: `src/lib/video-engine`, `src/lib/creative-jobs`, `src/lib/assets`, `src/lib/media-intelligence`,
`src/remotion`, `src/app/api/creative-studio`, `src/components/listing-video-panel.tsx`, the bake recipe.

| Category | Finding |
|---|---|
| TODO / FIXME / HACK / XXX | **0** in the module. |
| Dead code / unused imports | None flagged by `tsc --noEmit` (0 errors) + `eslint` (0 errors; 15 warnings, all `_`-prefixed unused args in unrelated `*.test.ts`). No module-level dead code found. Recommend a one-time `depcheck`/`ts-prune` pass (P2) to confirm no orphan exports. |
| Duplicated helpers | The font-guard shell/eval logic exists in BOTH `src/lib/video-engine/font-guard.ts` (runtime) and, replicated, inside the bake recipe's font gates. Intentional (recipe is standalone, cannot import app code) but is a **drift risk** — see debt D-P1-1. |
| Temporary comments | None ("spike", "placeholder", "temporary" not present in module source). |
| Experimental flags | `CREATIVE_STUDIO_VIDEO_ENABLED` (fail-closed 404 when unset) and `CRON_SECRET` (worker Bearer). Both are **intentional launch gates**, not experiments — Preview-only today. |
| Obsolete env vars | `CREATIVE_STUDIO_SANDBOX_IMAGE` is unused (only the snapshot path is used); keep as the documented image-fallback escape hatch. Legacy Supabase `anon`/`service_role` JWT keys still active project-wide (Lovable dependency) — drop post-cutover. |
| Unused dependencies | `@remotion/fonts` **removed** (F1-O). `sharp` promoted to a direct dep (used by downscale). No other obvious orphan; confirm with `depcheck` (P2). |
| Old/unreferenced snapshots | **Referenced (keep):** `snap_pabjEZEF…` (current, Preview var, non-expiring), `snap_8gmMWE8…` (rollback, non-expiring). **Unreferenced (self-expiring 30-day TTL):** the earlier validation-only `snap_sLqjP5Eha6U7…` + SDK auto-snapshots left by F1 validation sandboxes (`@vercel/sandbox` auto-snapshots on `stop()`), e.g. `snap_FBlVM4d…`. Safe to leave to expire or delete now. |
| Temporary assets | DB: none for live listings (F1 fixtures fully cleaned; the 3 historical **failed** jobs on listing `2da3ae77` are retained as evidence by owner instruction). Storage: `creative-studio` holds only the one live video. Local scratchpad inventories (`f1c/f1j-inventory.json`, chmod 600) are outside the repo. |

---

## 2. Performance

Measured from job-transition durations (the pipeline's own timestamps). "Before F1-N" = the
fonts-via-`loadFont` era; **the real 10-photo render did NOT complete then** (RENDER_TIMEOUT — the
per-tab font `delayRender` starved past 28 s at ~46 s of rendering). So the comparison is
"broken → working," plus a v1→v2 render-time regression to watch.

| Metric (10-photo listing) | Before F1-N | F1-O (system fonts) | F1-P (overlap crossfade, current) |
|---|---|---|---|
| Job outcome | **FAILED** (RENDER_TIMEOUT) | completed | completed |
| Sandbox startup (queued→running) | — | 1.96 s | 1.36 s |
| Bundle+select (running→rendering) | — | 11.1 s | 10.8 s |
| **Render (rendering→qa)** | died ~46 s | **89.9 s** | **141.9 s** |
| QA (ffprobe, in-sandbox) | — | 0.29 s | 0.30 s |
| Upload + read-verify | — | 2.38 s | 3.26 s |
| **Total worker wall-clock** | ~timeout | **105.7 s** | **157.7 s** |
| MP4 size | — | 44.5 MB | 42.6 MB |
| Duration / frames | — | 45.5 s / 1365 | 39.6 s / 1185 |

**Findings:**
- ✅ The font migration turned a non-completing render into a reliable one.
- ⚠️ **v2 render is ~52 s slower than v1 despite fewer frames** (142 s vs 90 s, 1185 vs 1365 frames).
  Likely the crossfade overlap renders **two photo layers** (double `<Img>` decode + Ken-Burns
  transform) on the ~180 overlap frames, plus normal 4-vCPU sandbox variance. This is a **single
  sample** — needs 3–5 runs to separate signal from variance. See debt **D-P1-2**.
- ⚠️ **Peak memory is not instrumented** — the render runs in a 4-vCPU/8-GB sandbox and we have no
  measurement. This mattered historically (large photos) and is a blind spot for Phase-2 video
  ingest. See debt **D-P0-3 / D-P1-3**.
- 1-photo render (F1-O fixture): 285 frames / 9.6 s MP4, total ~30 s — the fast-path baseline.

---

## 3. Observability

Present today (good):
- Every state transition is persisted to `creative_job_transitions` with `from/to state`, actor,
  and `duration_ms` — a real per-stage timeline.
- A stable `traceId` is stamped at job creation and threaded job → pipeline → `produceVideoAsset`
  → Asset `provenance.traceId` (recovery + correlation).
- `jobId`, `assetId`, `error_code` (closed set in `creative-jobs/errors.ts`) and a redacted,
  truncated `error_message` (URLs + `sb_secret_` tokens stripped) are persisted.
- Errors are **normalized** to a stable, retriable/non-retriable-classified code set.

Gaps / small improvements to propose (no behavior change beyond logging):
- **O-1 (P1):** persist the render provider's `RenderMediaMetrics` (`sandboxStartupMs`, `bundleMs`,
  `selectCompositionMs`, `renderMs`) — currently computed in `render-provider.ts` but discarded
  after the render. A `creative_jobs.metrics jsonb` column (or the Asset's provenance) would make
  §2 measurable without transition-diffing.
- **O-2 (P1):** capture **sandbox peak memory / vCPU** (e.g. read `/proc` at render end inside the
  sandbox and log it) — the biggest current blind spot.
- **O-3 (P0):** wire `SENTRY_DSN` — `instrumentation.ts` + `sentry.server.ts#capturePipelineError`
  are already built and are a **no-op until the DSN is set**. This is the single highest-leverage
  observability fix; the pipeline already calls the capture hook.
- **O-4 (P2):** the truncated `error_message` can drop the actionable tail on very long errors
  (seen when the embedded-font base64 filled the message pre-F1-O). Prefer capturing the render's
  real error to a file the provider reads back, rather than relying on sandbox stderr slicing.

---

## 4. Security (risks only)

| Area | Assessment | Risk |
|---|---|---|
| Buckets | `creative-studio` = **private**; `property-photos` = public (source photos). | OK. |
| RLS | Consolidated onto `user_roles`/`is_admin_or_broker()` (F1-O migration `2026…_consolidate_roles_rls`); `assets`/`creative_jobs` owner-scoped. The `users.role` self-escalation hole is closed by a trigger. | OK — verify `assets`/`creative_jobs` RLS explicitly has no `USING (true)` broker leak (spot-check, S-P1-1). |
| Signed URLs | Read-only, short TTL (120–300 s), generated per request; never persisted. | OK. |
| Expirations | Base artifact snapshots non-expiring (intentional). Signed URLs short-lived. | OK. |
| **Uploads** | v1 has **no user-uploaded media** — source photos are the seller's own `property_photos`. | **N/A for v1, but a hard requirement for Video Upload (Phase 2): MIME allow-list, size + duration caps, ffprobe-validate the container/codec BEFORE render, re-encode/transcode untrusted input, and virus/abuse scanning.** Flag now so it isn't skipped. |
| MIME / max size | Not enforced (no upload path yet). | Same as above — Phase-2 gate. |
| ffprobe | Runs **inside** the sandbox on the rendered output (QA), not on untrusted input. | OK for v1. For Phase 2, ffprobe must ALSO gate the *input* video. |
| Input sanitization | `inputProps` are server-built from ownership-checked data; `RenderManifest` is asserted secret-free; the composition addresses staged assets by rewritten refs. Guard runs before render. | OK. |
| Worker auth | `CRON_SECRET` Bearer, timing-safe compare; Production has none → fail-closed. | OK. |
| Rate limiting | `/generate` limited (5/h per user). `/status` is polled unthrottled (read-only). | Low — `/status` polling could be capped (S-P2-1). |

No **new** exploitable risk found in v1. The dominant security work is **all in the Video-Upload
input path** and must be treated as a first-class gate before that feature ships.

---

## 5. Documentation (state of record)

Authoritative docs that exist and are current after F1:
- **Base artifact / bake:** `docs/superpowers/runbooks/bake-sandbox-base.mjs` (self-validating recipe,
  incl. system-font gates) + `docs/superpowers/runbooks/2026-07-18-creative-studio-sandbox-artifact.md`.
- **System-fonts plan + compatibility matrix + rollback:** `docs/superpowers/plans/2026-07-21-system-fonts-base-artifact.md` (F1-M).
- **This document** (F1-R) — the consolidated state, render pipeline, font strategy, snapshots, rollback, troubleshooting.

Reference content (folded here so it lives in one place):

- **Architecture / render pipeline:** `POST /api/creative-studio/video/generate` (flag→auth→rate-limit
  →ownership→readiness→`createJob`) → `creative_jobs` (queued) → `POST /worker` (Bearer CRON_SECRET;
  Vercel Cron `*/5` on Production) claims one job → `buildRealProduce` wraps `property_photos` into
  `kind=photo` Assets, downscales to 1920×1080 (sharp), then `SandboxRemotionProvider.render`:
  Sandbox from snapshot → **font guard** → stage composition source + photos → `bundle →
  selectComposition → renderMedia(h264)` → in-sandbox ffprobe → read bytes → `produceVideoAsset`
  runs QA (`parseFfprobe`) → upload + read-verify → create video Asset → job `completed`.
- **Font strategy:** OS system fonts installed in the base artifact at `/usr/share/fonts/lixtara`
  (Playfair Display 500/600/500-italic + Inter 600, woff2→ttf via woff2-tools 1.0.2, sha256-pinned).
  `fonts.ts` exposes only CSS families. Fail-closed `font-guard.ts` asserts snapshot
  `/etc/lixtara-artifact-version` + `/etc/lixtara-font-strategy` match the code and all four faces
  `fc-match` to the exact files, else `FONT_STRATEGY_MISMATCH` (no fallback render).
- **Snapshots:** current `snap_pabjEZEF…` (v `base-2026-07-21-fonts-system-…`, iad1, ~1.115 GB,
  non-expiring, Preview var only). Rollback `snap_8gmMWE8…` (prior, non-expiring, intact).
- **Rollback:** `git revert` the system-fonts merge + repoint the Preview
  `CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID` to `snap_8gmMWE8…`. A partial rollback **fails closed** (the
  guard rejects a code↔snapshot mismatch) — it can never render with fallback fonts.
- **Troubleshooting quick map:**
  - Job stuck `queued` on Preview → no automatic worker on Preview; trigger `POST /worker` (Bearer
    CRON_SECRET) or wait for cron on Production. (Design gap D-P0-2.)
  - `FONT_STRATEGY_MISMATCH` → snapshot var and code artifact version disagree; repoint the var.
  - `RENDER_TIMEOUT` → historically the font delayRender (fixed) or a very heavy render; check
    photo count/size and sandbox vCPUs.
  - 422 `not_ready` → listing not `active` and/or <1 interior photo of usable quality.
  - 404 on `/generate` → `CREATIVE_STUDIO_VIDEO_ENABLED` unset (fail-closed, expected in Production).

**Recommended doc updates (P2 doc-debt):** promote the "reference content" above into a durable
`docs/creative-studio/README.md`, and add a short ADR ("ADR-00X: system fonts in the base artifact")
capturing the loadFont→system-fonts decision + the compatibility-guard rationale.

---

## 6. Technical-debt backlog (prioritized; effort in eng-days; **not implemented**)

**P0 — do before Phase 2 / any public launch**
- **D-P0-1 — Integration tests for the pipeline routes** (`generate`, `worker`, `status`) + a
  guard/mismatch path + a render-provider order test against a fake sandbox. Money/legal-adjacent
  and currently unit-only. **~3–4 d.**
- **D-P0-2 — Worker execution on Preview.** Today Vercel Cron runs only on Production; on Preview a
  UI-generated job sits `queued` forever (owner hit exactly this). Decide: a manual "run now"
  admin action, a short-lived Preview cron, or an explicit "Preview needs manual trigger" product
  note. **~1–2 d.**
- **D-P0-3 — Wire `SENTRY_DSN`** (Preview first) so `capturePipelineError` stops being a no-op.
  **~0.5 d.**

**P1 — before scaling usage**
- **D-P1-1 — De-duplicate the font-guard logic** shared between `font-guard.ts` and the bake recipe
  (single source of truth for the face list + fc-match assertions) to prevent drift. **~1 d.**
- **D-P1-2 — Re-measure v1-vs-v2 render time** across several runs; if the overlap regression is
  real, bound the double-layer window or pre-decode photos. **~1–2 d.**
- **D-P1-3 — Persist render metrics + sandbox peak memory** (O-1/O-2). **~1 d.**
- **S-P1-1 — Explicit RLS spot-check** on `assets`/`creative_jobs` (no `USING (true)` broker leak).
  **~0.5 d.**

**P2 — hygiene / nice-to-have**
- **D-P2-1 — `depcheck`/`ts-prune`** pass; drop legacy Supabase `anon`/`service_role` keys post-cutover. **~0.5 d.**
- **D-P2-2 — Delete/allow-expire** the unreferenced validation auto-snapshots; add
  `persistent:false`/ephemeral handling to future CI sandbox runs so they don't leave 30-day snapshots. **~0.5 d.**
- **D-P2-3 — Docs:** `docs/creative-studio/README.md` + ADR (§5). **~0.5 d.**
- **S-P2-1 — Cap `/status` polling**; improve long-error capture (O-4). **~0.5 d.**

---

## 7. Phase-2 roadmap (prioritized; not designed)

Ranked by value ÷ effort, reusing the v1 pipeline (Sandbox + Remotion + system fonts + worker):

| Rank | Capability | Reuses v1? | New infra | Notes |
|---|---|---|---|---|
| **1** | **Video Tour Upload** | ✅ heavily | upload bucket + input validation | Wrap the seller's uploaded clip (`<OffthreadVideo>`) with the existing brand intro/lower-third/closing. Highest value, lowest new infra. **Security-critical input path.** |
| 2 | Music | ✅ | licensed audio library | Add an audio track to the composition; small, high perceived polish. |
| 3 | Premium Templates | ✅ | none (more compositions) | New Remotion templates selectable per tier; monetizable. |
| 4 | Advanced branding | ✅ | none | Per-agent logo/colors/watermark via inputProps. |
| 5 | Social exports / Reels / Vertical tours | ✅ (new dims) | none | 9:16 / 1:1 renders + platform presets; reuses the engine with different `width/height`. |
| 6 | Voice-over | partial | TTS provider + script gen | AI narration synced to slides; new provider + timing. |
| 7 | Multi-language | ✅ | i18n of composition copy + TTS | Localized cards + (with #6) localized narration. |
| 8 | **AI Video Enhancement** | ❌ | video-processing provider | Stabilization / color / upscale of uploaded video — heaviest new infra; do AFTER Video Upload proves the ingest path. |

---

## Recommendation — what to build first

1. **Close P0 debt** (integration tests, Preview-worker decision, Sentry) — ~1 week; it makes
   everything after it safe to iterate on.
2. **Then build Video Tour Upload** as the first Phase-2 capability. It reuses this exact,
   now-validated pipeline; its only genuinely new surface is the **upload + input-validation
   security path** (§4), which should be its own design gate (like F1-M). Music + Premium
   Templates are cheap fast-follows on the same engine.
3. **Defer AI Video Enhancement** until Upload has proven the ingest/validation path — it is the
   only item needing substantial new infrastructure.

Production remains **fail-closed** and untouched; nothing here is implemented — this is audit,
documentation, and strategy only.
