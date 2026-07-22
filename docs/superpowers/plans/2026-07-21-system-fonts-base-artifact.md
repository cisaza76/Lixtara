# F1-M — System Fonts Base Artifact Plan (DESIGN + PREFLIGHT ONLY)

Status: **plan only.** No re-bake, no new artifact, no env change, no PR/merge/deploy, no E2E,
no Production, no removal of current fonts. Awaiting explicit authorization before any bake.

Root cause (proven, F1-experiment 2026-07-21): identical 10-photo / 1365-frame render fails in
the sandbox with `RENDER_TIMEOUT` **only** when `loadFont()`/custom fonts are present; with them
removed it completes (render phase ran 84s → completed, valid MP4). The font machinery
(`loadFont` → `delayRender` → per-Chrome-tab `FontFace` load) is the fault. This plan replaces it
with OS-level system fonts so no font is ever loaded at render time.

---

## 1. Current artifact state

| Field | Value |
|---|---|
| Bake recipe | `docs/superpowers/runbooks/bake-sandbox-base.mjs` (self-validating, fail-closed, `snapshotExpiration: 0`) |
| Runbook/spec | `docs/superpowers/runbooks/2026-07-18-creative-studio-sandbox-artifact.md` |
| Version tag | `BASE_ARTIFACT_VERSION = "base-2026-07-19-ffmpeg8.1.2-remotion4.0.489"` (`src/lib/video-engine/versions.ts`) |
| Snapshot (current) | `snap_8gmMWE8S5NgT5RfM4qfIiMztMfnC` — region `iad1`, ~1.066 GB, **non-expiring** |
| OS / arch | Amazon Linux 2023, **amd64**, Vercel Sandbox runtime `node24`, Node v24.14.1, 4 vCPU / 8 GB |
| Chromium | installed at bake via `@remotion/renderer` `ensureBrowser()` (chrome-headless-shell); X/GBM libs via `dnf` (`mesa-libgbm libX11 libXrandr libdrm libXdamage libXfixes …`) |
| Font install path (proposed) | `/usr/share/fonts/lixtara/` (a standard fontconfig scan dir) |
| Cache / versioning | Immutable snapshot; `snapshotExpiration: 0`; snapshots have distinct ids and are never overwritten |
| **Selection reference** | `CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID` env var (**Preview-only** today). `BASE_ARTIFACT_VERSION` is a descriptive provenance tag, **not** an activation switch. |

## 2. Exact fonts (only what the composition uses)

From `src/remotion/ListingVideo.tsx` — the ONLY consumer of `SERIF`/`SANS`:

| Family | Weight | Style | Source file | sha256 |
|---|---|---|---|---|
| Playfair Display | 500 | normal | `public/fonts/PlayfairDisplay-500.woff2` | `e299ff10…dab5` |
| Playfair Display | 600 | normal | `public/fonts/PlayfairDisplay-600.woff2` | `9b70843a…e4c4` |
| Playfair Display | 500 | italic | `public/fonts/PlayfairDisplay-500Italic.woff2` | `52d7a083…df97` |
| Inter | 600 | normal | `public/fonts/Inter-600.woff2` | `9a3d22c4…f031` |

- **No unused families/weights** — exactly these four. (Playfair 400/700/900, Inter 400/500/700 etc. are NOT used and will NOT be installed.)
- License: **SIL OFL 1.1** (`public/fonts/LICENSE.txt`) — redistribution permitted, files unmodified. Vendored from Google Fonts.
- **Format problem (evidence-based):** these are `.woff2` (a WEB format). `fc-scan` returns **empty** for all four → fontconfig/FreeType does not read woff2, so Chrome on Linux would not see them as system fonts. **They must be converted to TTF/OTF** (see §3). Conversion is lossless (woff2 is only sfnt compression), so the brand-approved glyph data is preserved.
- **Internal family names — CONFIRMED (see preflight results below).** The current `loadFont()` aliased them as `"Lixtara Playfair Display"` / `"Lixtara Inter"`; the real name-table families are `"Playfair Display"` and `"Inter"`. The CSS in §4 uses those exact names.

### Preflight results — local, transient (2026-07-21). No files committed.

**Conversion tool:** `woff2_decompress` from **google/woff2 1.0.2** (Homebrew bottle `woff2--1.0.2`; identical library is available in AL2023 via `dnf install woff2`). **Reproducible:** re-running the conversion produced byte-identical output (verified by sha256). It is a lossless reconstruction of the sfnt (glyph data preserved); the same tool+version must be used in the bake to reproduce these exact TTF hashes — the definitive hashes are re-confirmed in the in-artifact preflight.

**SHA-256 — source woff2 (unchanged, vendored):**

| file | sha256 |
|---|---|
| Inter-600.woff2 | `9a3d22c43636255dd1d3c910c534e1b55ecdcaf074ffa013971fad0d4d32f031` |
| PlayfairDisplay-500.woff2 | `e299ff10d0630a4b18fc890eef6ccc5181846c38f78440db8c3e01758827dab5` |
| PlayfairDisplay-500Italic.woff2 | `52d7a083285c974592ae6c7c5cb0d242ed43d10574e7c3ec60dda4ab2858df97` |
| PlayfairDisplay-600.woff2 | `9b70843ad2079a0738ec89773c6abb48f92d66554f0df6e8bc4474b6d1d5e4c4` |

**SHA-256 — converted TTF (woff2_decompress 1.0.2):**

| file | sha256 |
|---|---|
| Inter-600.ttf | `69f0cc85622514b41e7e4b70d3fb37ec883b97b05369d5c4c353ff89a096e088` |
| PlayfairDisplay-500.ttf | `0143eb178b14b5b917f2c6845bdc1fd22f4c2b6e90c2c8c2db01beb2cb1ccea0` |
| PlayfairDisplay-500Italic.ttf | `58c071c10721736c45761a3d05aab33e5d4f5f3acee8fb348b2697aa5ad47f17` |
| PlayfairDisplay-600.ttf | `260abf6d34f390cee83aaef74d1047a5a967be67085bf8e27cfe9f44962af284` |

**`fc-scan` on each converted TTF (fontconfig 2.17.1):**

| TTF | family | style | fc weight | slant | PostScript name | format |
|---|---|---|---|---|---|---|
| PlayfairDisplay-500.ttf | Playfair Display, Playfair Display Medium | Medium | 100 (medium) | 0 | `PlayfairDisplay-Medium` | TrueType |
| PlayfairDisplay-600.ttf | Playfair Display, Playfair Display SemiBold | SemiBold | 180 (semibold) | 0 | `PlayfairDisplay-SemiBold` | TrueType |
| PlayfairDisplay-500Italic.ttf | Playfair Display, Playfair Display Medium | Medium Italic | 100 (medium) | 100 (italic) | `PlayfairDisplay-MediumItalic` | TrueType |
| Inter-600.ttf | Inter, Inter SemiBold | SemiBold | 180 (semibold) | 0 | `Inter-SemiBold` | TrueType |

**Isolated fontconfig `fc-match`** (a temp `FONTCONFIG_FILE` scanning ONLY the TTF dir; `fc-cache -f`):

| query | resolves to |
|---|---|
| `Playfair Display:weight=medium` | `PlayfairDisplay-500.ttf` ✓ |
| `Playfair Display:weight=semibold` | `PlayfairDisplay-600.ttf` ✓ |
| `Playfair Display:weight=medium:slant=100` | `PlayfairDisplay-500Italic.ttf` ✓ |
| `Inter:weight=semibold` | `Inter-600.ttf` ✓ |

> ⚠️ `fc-match` **always returns something** (e.g. `Helvetica` fell through to our first font in isolation; `weight=bold` fell to the nearest = SemiBold). So a green `fc-match` proves resolution only when you assert the **returned file** is the expected one — file presence alone is never sufficient (this is the "silent fallback" risk, §9).

**Chromium proof (Playwright/Chromium, `@font-face`-loaded the exact TTFs):**
- `document.fonts.check()` = **true** for all four: `500 "Playfair Display"`, `600 "Playfair Display"`, `italic 500 "Playfair Display"`, `600 "Inter"`; all four `FontFace.status === "loaded"`.
- **No silent fallback:** rendered text width differs from the generic fallback (Playfair 500 = 352.7px vs generic serif 328.8px; Inter 600 = 381.9px vs generic sans 375.8px), and `getComputedStyle().fontFamily` returns the requested families.
- Visual PNG confirmed the four faces render as Playfair Medium / SemiBold / Medium-Italic / Inter-SemiBold, visibly distinct from the generic serif/sans rows.

> Scope note: this local proof validates the **conversion + fontconfig resolution + Chromium rendering** of the TTFs. macOS Chromium uses CoreText, not fontconfig, so the definitive **fontconfig → Chrome system-font resolution on Linux/AL2023** is validated by the in-artifact preflight (§6).

## 3. Installation method (in the bake, Amazon Linux 2023 / dnf)

Add these as **fail-closed gates in `bake()` before `snapshot()`** (same pattern as the ffmpeg/libx264/smoke gates):

```sh
# 3.1 tools (verify these packages resolve in AL2023 during preflight; woff2 tools may need EPEL —
#      fallback: ship pre-converted .ttf built locally with fonttools instead of converting in-sandbox)
sudo dnf install -y fontconfig woff2

# 3.2 convert the four approved woff2 -> ttf (lossless)
for f in PlayfairDisplay-500 PlayfairDisplay-600 PlayfairDisplay-500Italic Inter-600; do
  woff2_decompress "$f.woff2"     # -> "$f.ttf"
done

# 3.3 install into a fontconfig scan dir
sudo mkdir -p /usr/share/fonts/lixtara
sudo cp *.ttf /usr/share/fonts/lixtara/
sudo chmod 644 /usr/share/fonts/lixtara/*.ttf

# 3.4 rebuild the fontconfig cache
sudo fc-cache -f
```

**Verification (does NOT trust file presence alone):**

```sh
fc-list | grep -Ei "playfair|inter"                       # expect 4 entries
fc-scan --format "%{family} | %{style} | %{weight} | %{slant}\n" /usr/share/fonts/lixtara/*.ttf
fc-match "Playfair Display:weight=medium"                 # -> PlayfairDisplay-500.ttf (not a fallback)
fc-match "Playfair Display:weight=semibold"               # -> PlayfairDisplay-600.ttf
fc-match "Playfair Display:italic:weight=medium"          # -> PlayfairDisplay-500Italic.ttf
fc-match "Inter:weight=semibold"                          # -> Inter-600.ttf
```

**Chrome-level check (the real proof):** a headless-Chromium/Remotion snippet that asserts the
families resolve, e.g. `document.fonts.check('500 24px "Playfair Display"') === true` and
`document.fonts.check('600 24px "Inter"') === true`, plus a 1-frame PNG capture for visual review.
A pass here is what proves Chrome (not just fontconfig) sees the fonts.

## 4. Proposed code change (diff — NOT applied)

`src/remotion/fonts.ts` becomes pure CSS names, zero async, zero delayRender:

```diff
-import { loadFont } from "@remotion/fonts";
-import { PLAYFAIR_500, PLAYFAIR_600, PLAYFAIR_500_ITALIC, INTER_600 } from "./fonts-data";
-
-export const SERIF = "Lixtara Playfair Display";
-export const SANS = "Lixtara Inter";
-
-const fontFiles = [ /* …four loadFont entries… */ ];
-export const fontsReady: Promise<unknown> = Promise.all(fontFiles.map((font) => loadFont(font)));
+// System fonts installed in the sandbox base artifact (/usr/share/fonts/lixtara). No render-time
+// font loading — no loadFont(), no delayRender, no per-tab FontFace. Fallbacks are a safety net;
+// the artifact preflight guarantees the primary faces resolve.
+export const SERIF = '"Playfair Display", Georgia, serif';
+export const SANS  = '"Inter", Arial, sans-serif';
```

(Family strings pending §2 internal-name confirmation.) `ListingVideo.tsx` is unchanged — it already
consumes `SERIF`/`SANS` as `fontFamily` with explicit `fontWeight`/`fontStyle`.

**Becomes obsolete — ENUMERATED, not removed in this gate:**
- dependency `@remotion/fonts`
- `src/remotion/fonts-data.ts` (generated data URIs)
- `scripts/embed-fonts.mjs`
- `src/remotion/fonts-data.test.ts`
- render-provider font staging — already removed in PR #96

**Keep:** `public/fonts/*.woff2` remain the **vendored source of truth** the bake converts from; they
are no longer a runtime bundle asset but must not be deleted.

## 5. Versioning strategy

| | Value |
|---|---|
| Current version | `base-2026-07-19-ffmpeg8.1.2-remotion4.0.489` / `snap_8gmMWE8S5NgT5RfM4qfIiMztMfnC` |
| Proposed new tag | `base-2026-07-21-fonts-system-ffmpeg8.1.2-remotion4.0.489` |
| New snapshot id | emitted by the re-bake (unknown until baked); `snapshotExpiration: 0` (immutable, non-expiring) |
| Digest | the snapshot id **is** the immutable digest; additionally record the 4 TTF sha256 + the 4 source woff2 sha256 in the runbook |
| Activation | update `BASE_ARTIFACT_VERSION` in `versions.ts`; set `CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID` (**Preview only**) to the new id |
| No overwrite | snapshots have distinct ids and never mutate; the current one is non-expiring → **retained for rollback** |
| Self-declared version | the bake writes the version tag into the snapshot as `/etc/lixtara-artifact-version` **and** its provided font strategy as `/etc/lixtara-font-strategy` (`system`), so the artifact declares its own identity independent of any env bookkeeping (used by the §8 fail-closed guard) |

## 6. In-artifact preflight (gates the re-bake must pass before snapshot)

1. `fc-match "Inter:weight=semibold"` → Inter SemiBold file.
2. `fc-match "Playfair Display:weight=medium|semibold|italic"` → the three correct Playfair files.
3. `fc-list | grep -Ei "playfair|inter"` count == 4.
4. Chrome: `document.fonts.check()` true for both families at the used weights; capture a 1-frame PNG.
5. Composition asserts NO font `loadFont`/`delayRender` (grep `src/remotion/fonts.ts`).
   All fail-closed → no snapshot unless every gate is green.

## 7. Validation plan (future gate, in this order)

1. Artifact built (all bake gates green). 2. Fonts verified inside the artifact (§6). 3. Minimal
in-sandbox render. 4. Full local render. 5. Preview render with **1 photo**. 6. Preview render with
the **same 10 real photos** (listing `2da3ae77`). 7. MP4 + `ffprobe` (h264/1920×1080/30fps/45.5s).
8. Visual typography comparison vs a reference frame (Playfair display + Inter present, not fallback).
9. Rollback rehearsed and confirmed.

## 8. Compatibility unit, fail-closed guard, and rollback

**The unit of compatibility is `code release ↔ base snapshot`.** The font strategy lives in BOTH:
the code (does `fonts.ts` call `loadFont` — the `runtime` strategy — or only CSS names — the
`system` strategy?) and the snapshot (does it ship system fonts?). The dangerous combination is:

```
code = system (no loadFont)   +   snapshot = old (no /usr/share/fonts/lixtara)
        → text silently renders in Georgia/Arial fallback, no error
```

This must be **impossible to reach silently**. Chosen design = **Alternative B (versioned pairing)
reinforced with a render-time capability probe** — no permanent fork (Alt C rejected), and the code
still ships/rolls back as one commit (Alt A folded in).

### Two fail-closed guards (defense in depth)

**Guard 1 — render-time capability probe (primary; needs no human bookkeeping).** Before rendering,
the in-sandbox render script requires the strategy the CODE declares (passed in the render manifest,
e.g. `fontStrategy: "system"`) to be actually present, and **aborts loudly** otherwise:
- for `system`: `fc-match "Playfair Display:weight=medium"` (and the other three) MUST resolve to a
  file under `/usr/share/fonts/lixtara/`; if any resolves elsewhere (fallback) → throw
  `FONT_STRATEGY_MISMATCH`, no render. This turns the exact "new code + old snapshot" combo into a
  clean failure instead of a silent-fallback MP4.

**Guard 2 — self-declared version assertion (belt-and-suspenders).** The snapshot carries
`/etc/lixtara-artifact-version` and `/etc/lixtara-font-strategy` (baked in, §5). The render script
asserts they equal the code's `BASE_ARTIFACT_VERSION` and required strategy; mismatch → throw before
render. This catches a mispointed `CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID` even for identical fonts.

Both are fail-closed: **any mismatch aborts the render with a distinct error; it never falls back.**

### Compatibility matrix

| Code release (`BASE_ARTIFACT_VERSION`) | Snapshot provides | Guard 1 (fc probe) | Guard 2 (version) | Result |
|---|---|---|---|---|
| `…-fonts-system` (no loadFont) | new snap: system fonts | ✅ resolves to lixtara TTFs | ✅ match | **render OK** |
| `…-fonts-system` (no loadFont) | old snap: no system fonts | ❌ falls back | ❌ mismatch | **fail-closed (no MP4)** |
| `2026-07-19` (loadFont) | old snap: runtime loadFont | n/a (strategy=runtime) | ✅ match | render OK (current path) |
| `2026-07-19` (loadFont) | new snap: system fonts | n/a | ❌ mismatch | **fail-closed** (harmless combo, still blocked) |

**Fail-closed criterion (explicit):** the worker/render aborts with `FONT_STRATEGY_MISMATCH` (Guard 1)
or `ARTIFACT_VERSION_MISMATCH` (Guard 2) — surfaced as a normal job `failed` with that error_code —
whenever the running code's declared font strategy/version does not match what the snapshot actually
provides. No render is ever produced with the wrong font source.

### Rollback (coordinated unit — safe even if done in halves)

The system-fonts change ships as **one commit** (`fonts.ts` → CSS, drop `@remotion/fonts` dep,
`versions.ts` new tag). Rollback = restore the pair:
1. `git revert` that single merge commit (restores `loadFont` + the old `BASE_ARTIFACT_VERSION`).
2. Set `CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID` (Preview) back to `snap_8gmMWE8S5NgT5RfM4qfIiMztMfnC`.
3. Redeploy Preview.

Because of the two guards, an *incomplete* rollback (only the code, or only the env) does **not**
mis-render — it fails closed with a clear error, so you notice and finish the pair. No emergency
rebuild is ever required: the old snapshot is immutable + non-expiring.

**Trigger rollback if:** the probe/version guard fires, Chrome uses a fallback, layout shifts, the
render fails, or any material visual typography difference appears vs the reference frame.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **woff2 ≠ system font** — fontconfig can't read woff2 (proven: `fc-scan` empty) | Convert to TTF (`woff2_decompress`, lossless) before install |
| **Filename ≠ internal family name** — `fc-match` keys on the name table | Confirm internal names with `fc-scan` on the TTFs; CSS uses the real internal name |
| **Synthetic weights** (faux-bold/italic) | Install exact static instances (500/600/500-italic/Inter-600); assert `fc-match` returns the specific weight file |
| **Silent fallback** — Chrome renders Georgia/Arial with no error | Verify with `fc-match` + `document.fonts.check` + a visual frame, never file-presence-only |
| **fontconfig / woff2 tool absent in AL2023** | Install `fontconfig`; if `woff2` pkg needs EPEL, fall back to shipping pre-converted TTFs built locally with fonttools |
| **Local ≠ sandbox rendering** | The whole point — validate in-sandbox (steps 3, 5, 6) and diff vs local |
| **Licenses** | OFL 1.1 permits redistribution unmodified; woff2→ttf changes container, not glyphs — note in runbook alongside the existing GPL-ffmpeg distribution note |
| **Artifact size** | +~400 KB of TTFs — negligible vs ~1.066 GB |
| **Cache invalidation** | New immutable snapshot id; env repointed; old snapshot retained |
| **Other compositions** | Only `ListingVideo` uses these families today; install is additive (no existing sandbox fonts removed) |

## Approval criteria (to green-light the re-bake, a later gate)

- §2 internal family names confirmed on the converted TTFs.
- §3 install method verified feasible (packages resolve in AL2023 / preflight command dry-run).
- Owner sign-off on the new version tag + the "old snapshot retained for rollback" guarantee.
- Explicit authorization to re-bake (this plan does NOT include that authorization).
