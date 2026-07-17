# Render Debugging Guide — Vercel Sandbox + Remotion

**Audience:** any developer working on the Creative Studio video render (P2+).
**Not an ADR** — operational documentation distilled from Spike P2.0
(`docs/superpowers/spikes/2026-07-15-p2.0-sandbox-render.md`). Save yourself the hours the spike
already spent.

---

## Symptom → cause → fix

| Symptom | Root cause | Fix |
|---|---|---|
| `ffprobe` exits **127** (command not found) | `ffprobe` isn't installed in the sandbox | Put ffmpeg **and ffprobe** in the prebuilt base. If using johnvansickle static builds (`.tar.xz`), you also need **`xz`** — `sudo dnf install -y xz tar` before `tar -xf`. |
| `sandbox.runCommand("ffprobe", …)` throws **`Status code 400`** (empty body) | Calling a **missing binary directly** yields an opaque API 400 (via the SDK's auto-resume), not a clean exit code | Run in-sandbox commands through a shell: `sandbox.runCommand("sh", ["-c", "ffprobe …"])` → you get a clean **exit 127** you can handle. Use `sh -c` for anything that might be absent. |
| Command exits **137** | SIGKILL — the command hit its timeout (or the sandbox lifetime) | Confirm cleanup ran: `sandbox.stop()` + temp deletion must be in a `finally`. Check the command `timeoutMs` vs the sandbox `timeout` (lifetime). Treat 137 as a controlled timeout → job `failed` (`error_code: 'timeout'`), not a crash. |
| First render slow; every render pays install cost | The sandbox runs `npm install` + Chromium download + OS-dep install **per job** | **Prebuilt artifact is mandatory.** Bake Node + Chromium + its OS libs + ffmpeg + ffprobe + xz + the pinned Remotion packages into a versioned base. Per job = render only. Spike prep was ~38 s + ~362 MB — do it **once**. |
| `bundle()` slow on every render | Re-bundling the Remotion project each render | Bundle **once per template version** and cache it; reuse `serveUrl` across renders. Spike: cold bundle 3.5 s → cached 1.1 s. |
| Chromium fails to launch (missing `.so`) | Amazon Linux 2023 base lacks the shared libs Chromium needs | Install Remotion's Linux deps: `mesa-libgbm libX11 libXrandr libdrm libXdamage libXfixes libxkbcommon dbus-libs libXcomposite alsa-lib nss dbus pango cups-libs at-spi2-core atk at-spi2-atk` (see remotion.dev/docs/miscellaneous/linux-dependencies). Put them in the base. |
| Vercel Sandbox auth: `Could not get credentials from OIDC context` | `VERCEL_OIDC_TOKEN` expired (short-lived, ~12 h) | Refresh: `vercel env pull <file>` (project must be linked) → reload the token. In production the platform injects a fresh token; locally, re-pull. |
| `renderMedia` output has wrong codec/res/fps | inputProps/composition mismatch, or codec not `h264` | Pass the **same inputProps** to `selectComposition()` and `renderMedia()`; set `codec: "h264"`. Verify with `ffprobe -show_streams -show_format -print_format json`. |
| Checksums differ across identical renders | H.264 encoder writes timestamps/metadata; bit-identical output is not guaranteed | **Expected — not a bug.** Reproducibility is functional/visual, not byte-identical. Use the checksum for Asset integrity of *that* file, not as a determinism proof. |

## Reference numbers (Spike P2.0, iad1, node24, 4 vCPU/8 GB, Remotion 4.0.489)

- sandbox create ~0.4 s · npm install ~12 s · Chromium OS deps ~18 s · Chromium download ~1.8 s ·
  ffmpeg (+xz) ~5 s → **one-time prep ~38 s**.
- `renderMedia` **~13.4 s** (stable across 3 runs) for a 13 s / 720p / 30 fps video; total per-render
  wall ~15–18 s; ffprobe ~0.3 s; MP4 retrieval ~0.4 s; `sandbox.stop()` ~5.4 s.
- Est. cost **order of cents per video** (active CPU) — confirm the current Sandbox rate.

## Golden rules
1. **Prebuilt artifact, not per-job install.** Version it; record `baseArtifactVersion` in provenance.
2. **`sh -c` for in-sandbox commands** — clean exit codes, no opaque 400s.
3. **Always `sandbox.stop()` + temp cleanup in `finally`** — every path, including timeout/error.
4. **Bundle once per template version**, render many.
5. **Pin exact versions** (all Remotion packages equal, no caret) — reproducibility.
6. **ffprobe is the QA gate** (`sh -c`): mp4 / h264 / exact res / fps / duration / size>0. `completed`
   only after upload + Asset + QA all pass.
