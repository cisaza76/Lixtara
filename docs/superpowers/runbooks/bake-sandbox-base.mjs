// Creative Studio — Sandbox base artifact BAKE recipe (v3, hardened + self-validating). NOT
// run against production here. Prepares ONE Vercel Sandbox with everything the per-render
// worker needs baked in, PROVES the toolchain in-sandbox (ffmpeg/libx264 + a real Remotion
// h264 smoke render, ffprobe-checked), and only then snapshots it. bake() returns the
// snapshotId; the owner records it into CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID as a separate step.
//
// Derived from the validated Gate B2 spike (docs/superpowers/spikes/2026-07-15-p2.0-sandbox
// -render.md, PASS), with four hardening deltas:
//   1. Bakes @remotion/fonts@4.0.489 (the real composition loads vendored fonts; spike omitted).
//   2. React aligned to the APP's 19.2.4 (Remotion 4.0.489 peer is react>=16.8.0; the
//      composition uses no React-18/19-only API — so aligning removes the spike's 18.3.1 drift).
//   3. ffmpeg/ffprobe PINNED: exact version + fixed URL + fail-closed SHA-256 verify (no "latest").
//   4. SELF-VALIDATING + fail-closed: runtime-verifies ffmpeg/ffprobe/libx264 and runs a real
//      Remotion h264 1920x1080/30fps smoke render (ffprobe-asserted) BEFORE snapshot(), all in the
//      one bake() pipeline — the snapshot is taken only if every check passes, so a bad artifact
//      can never be produced or promoted.
//
// Target: Vercel Sandbox runtime "node24" (Amazon Linux 2023, Node v24.14.1), 4 vCPU / 8 GB, amd64.
import { Sandbox } from "@vercel/sandbox";

const PINNED = {
  "@vercel/sandbox": "2.6.1",
  remotion: "4.0.489",
  "@remotion/bundler": "4.0.489",
  "@remotion/renderer": "4.0.489",
  "@remotion/fonts": "4.0.489",
  react: "19.2.4",        // aligned to the app (was 18.3.1 in the spike)
  "react-dom": "19.2.4",
};

// ---- ffmpeg/ffprobe: PINNED static build, verified by SHA-256, fail-closed ----
// Choose an immutable, versioned artifact URL (recommended: a BtbN/FFmpeg-Builds GitHub
// release asset, or a johnvansickle dated release). Fill FFMPEG_SHA256 ONCE from the pinned
// URL: `curl -fsSLo f.tar.xz "$FFMPEG_URL" && sha256sum f.tar.xz`. The bake MUST fail if the
// downloaded bytes don't match — never install an unverified binary.
const FFMPEG = {
  // BtbN/FFmpeg-Builds n8.1.2-22-g94138f6973, linux64 GPL variant (extra-version 20260717).
  // Checksum verified locally 2026-07-18; runtime validation deferred to the first authorized bake.
  // GPL v3 (LICENSE.txt in the archive) — distribution note remains open (see runbook).
  version: "8.1.2",
  url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-17-13-22/ffmpeg-n8.1.2-22-g94138f6973-linux64-gpl-8.1.tar.xz",
  sha256: "ca1b5eb366743fc44a415e1496dd39a8b3266d99d786bd3eb8cbd837452e306e",
};

const CHROMIUM_DEPS =
  "sudo dnf install -y mesa-libgbm libX11 libXrandr libdrm libXdamage libXfixes " +
  "libxkbcommon dbus-libs libXcomposite alsa-lib nss dbus pango cups-libs at-spi2-core atk at-spi2-atk";

const FFMPEG_INSTALL = [
  "set -e",
  "sudo dnf install -y xz tar",
  "cd /tmp",
  `curl -fsSL -o ffmpeg.tar.xz "${FFMPEG.url}"`,
  // fail-closed: sha256sum -c exits non-zero (=> set -e aborts) if the hash doesn't match.
  `echo "${FFMPEG.sha256}  ffmpeg.tar.xz" | sha256sum -c -`,
  "tar -xf ffmpeg.tar.xz",
  "DIR=$(tar -tf ffmpeg.tar.xz | head -1 | cut -f1 -d/)",
  // BtbN linux64 archives nest the binaries under $DIR/bin/ (not the archive root).
  'sudo cp "/tmp/$DIR/bin/ffmpeg" "/tmp/$DIR/bin/ffprobe" /usr/local/bin/',
  "sudo chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe",
].join(" && ");

const ENSURE_CHROMIUM = `import { ensureBrowser } from "@remotion/renderer"; await ensureBrowser(); console.log("CHROMIUM_OK");`;
const BASE_PACKAGE_JSON = JSON.stringify(
  { name: "creative-studio-sandbox-base", private: true, type: "module", dependencies: PINNED }, null, 2);

// ---- In-sandbox smoke render — proves the SAME toolchain the worker uses (bundle ->
// selectComposition -> renderMedia{codec:"h264"}, see render-provider.ts) produces a valid
// 1920x1080/30fps h264 MP4 in THIS artifact. Self-contained: a minimal animated composition
// (opacity ramp, so frames actually encode) — no Supabase, no listing, no source photos, no
// secrets. registerRoot via React.createElement to avoid needing a JSX transform.
const SMOKE_ENTRY = `import React from "react";
import { registerRoot, Composition, AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
const Smoke = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15, 29], [0.25, 1, 0.25]);
  return React.createElement(AbsoluteFill, { style: { backgroundColor: "#0b0b0c", opacity } });
};
const Root = () =>
  React.createElement(Composition, {
    id: "Smoke", component: Smoke, durationInFrames: 30, fps: 30, width: 1920, height: 1080,
  });
registerRoot(Root);
`;
const SMOKE_RENDER = `import path from "node:path";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
const serveUrl = await bundle({ entryPoint: path.resolve("smoke-entry.jsx"), onProgress: () => {} });
const composition = await selectComposition({ serveUrl, id: "Smoke" });
await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: "/tmp/smoke.mp4" });
console.log("RENDER_SMOKE_OK");
`;
// System ffprobe (the pinned 8.1.2 build) reads the rendered MP4; each grep -qx exits non-zero
// on any mismatch, so `set -e` aborts the whole step => no snapshot on a bad render.
const SMOKE_FFPROBE_ASSERT = [
  "set -e",
  "ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate " +
    "-of default=noprint_wrappers=1 /tmp/smoke.mp4 > /tmp/smoke.probe",
  "cat /tmp/smoke.probe",
  "grep -qx 'codec_name=h264' /tmp/smoke.probe",
  "grep -qx 'width=1920' /tmp/smoke.probe",
  "grep -qx 'height=1080' /tmp/smoke.probe",
  "grep -qx 'r_frame_rate=30/1' /tmp/smoke.probe",
].join(" && ");

export async function bake() {
  if (FFMPEG.sha256.startsWith("<PIN")) throw new Error("bake refused: FFMPEG.sha256 not pinned");
  // NOTE: @vercel/sandbox 2.6.1 CreateSandboxParams has NO `region` input — `region` is a
  // read-only property of the created Sandbox; placement follows the project/deployment, and
  // passing it here would be silently ignored. Intentionally omitted (do not re-add as a knob).
  const sandbox = await Sandbox.create({ runtime: "node24", resources: { vcpus: 4 } });
  await sandbox.writeFiles([
    { path: "package.json", content: Buffer.from(BASE_PACKAGE_JSON, "utf8") },
    { path: "ensure-chromium.mjs", content: Buffer.from(ENSURE_CHROMIUM, "utf8") },
    { path: "smoke-entry.jsx", content: Buffer.from(SMOKE_ENTRY, "utf8") },
    { path: "render-smoke.mjs", content: Buffer.from(SMOKE_RENDER, "utf8") },
  ]);
  const sh = (label, cmd, timeoutMs = 300000) =>
    sandbox.runCommand("sh", ["-c", cmd], { timeoutMs }).then(async (r) => {
      if (r.exitCode !== 0) throw new Error(`${label} failed (exit ${r.exitCode}): ${(await r.stderr()).slice(-2000)}`);
      return r;
    });

  // ---- Prepare the artifact ----
  await sh("npm-install", "npm install --no-audit --no-fund");
  await sh("chromium-os-deps", CHROMIUM_DEPS);
  await sh("ensure-chromium", "node ensure-chromium.mjs");
  await sh("ffmpeg-pinned", FFMPEG_INSTALL);   // fail-closed on checksum mismatch

  // ---- Validate the artifact IN-PLACE (fail-closed): every check below must pass, or the
  // throw aborts bake() before snapshot() is ever reached — no snapshot, no artifact, no
  // promotion on any failure. This is the single self-validating pipeline (no separate driver).
  await sh("verify-node", "node --version");
  await sh("verify-ffprobe", "ffprobe -version | head -1");
  await sh("verify-ffmpeg", "ffmpeg -version | head -1");
  // grep exits non-zero if libx264 is not among the encoders => step fails => no snapshot.
  await sh("verify-libx264", "ffmpeg -hide_banner -encoders | grep -w libx264");
  // Real Remotion h264 render (same API as the worker) — 600s budget for bundle + render.
  await sh("render-smoke", "node render-smoke.mjs", 600000);
  // Assert the rendered MP4 is h264 / 1920x1080 / 30fps via the pinned ffprobe.
  await sh("ffprobe-smoke", SMOKE_FFPROBE_ASSERT);

  // ---- Only now, with ALL evidence green, capture the immutable artifact. snapshot() stops
  // the session as part of the process (no separate stop() needed). The emitted snapshotId is
  // recorded by the owner into CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID + a BASE_ARTIFACT_VERSION
  // bump as SEPARATE, later steps — NOT here.
  const snap = await sandbox.snapshot();
  console.log("SNAPSHOT_ID=" + snap.snapshotId);
  console.log("SNAPSHOT_SIZE_BYTES=" + snap.sizeBytes);
  return snap.snapshotId;
}
