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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// ---- Lixtara SYSTEM fonts (F1-N) -------------------------------------------------------
// The composition loads its fonts at OS level (no runtime loadFont/delayRender — that
// starved a real 10-photo render's per-tab FontFace load past its 28s timeout). Only the
// four faces ListingVideo.tsx uses. Source woff2 are vendored in public/fonts/; the bake
// converts them to TTF with `woff2_decompress` (google/woff2 1.0.2 = AL2023 `woff2-tools`,
// byte-reproducible — verified in F1-M/F1-N Step 1) and installs them into a fontconfig dir.
const NEW_ARTIFACT_VERSION = "base-2026-07-21-fonts-system-ffmpeg8.1.2-remotion4.0.489";
const FONT_STRATEGY = "system";
const FONT_DIR = "/usr/share/fonts/lixtara";
// filename -> { ttfSha256 (F1-M/Step1-verified), fcMatch pattern that MUST resolve to it }
const FONTS = [
  { woff2: "PlayfairDisplay-500.woff2",       ttf: "PlayfairDisplay-500.ttf",       sha256: "0143eb178b14b5b917f2c6845bdc1fd22f4c2b6e90c2c8c2db01beb2cb1ccea0", match: "Playfair Display:weight=medium" },
  { woff2: "PlayfairDisplay-600.woff2",       ttf: "PlayfairDisplay-600.ttf",       sha256: "260abf6d34f390cee83aaef74d1047a5a967be67085bf8e27cfe9f44962af284", match: "Playfair Display:weight=semibold" },
  { woff2: "PlayfairDisplay-500Italic.woff2", ttf: "PlayfairDisplay-500Italic.ttf", sha256: "58c071c10721736c45761a3d05aab33e5d4f5f3acee8fb348b2697aa5ad47f17", match: "Playfair Display:weight=medium:slant=100" },
  { woff2: "Inter-600.woff2",                 ttf: "Inter-600.ttf",                 sha256: "69f0cc85622514b41e7e4b70d3fb37ec883b97b05369d5c4c353ff89a096e088", match: "Inter:weight=semibold" },
];
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FONTS_SRC_DIR = path.join(REPO_ROOT, "public", "fonts");

// Install: convert woff2->ttf, fail-closed hash-verify against the F1-M hashes, install +
// fc-cache, then write the two self-declared manifests the runtime guard reads.
const FONT_INSTALL = [
  "set -e",
  "sudo dnf install -y fontconfig woff2-tools",
  "cd fonts",
  "for f in *.woff2; do woff2_decompress \"$f\"; done",
  "sha256sum -c ttf.sha256",                       // fail-closed: aborts if any TTF hash differs
  `sudo mkdir -p ${FONT_DIR}`,
  `sudo cp *.ttf ${FONT_DIR}/`,
  `sudo chmod 644 ${FONT_DIR}/*.ttf`,
  "sudo fc-cache -f",
  `echo "${NEW_ARTIFACT_VERSION}" | sudo tee /etc/lixtara-artifact-version >/dev/null`,
  `echo "${FONT_STRATEGY}" | sudo tee /etc/lixtara-font-strategy >/dev/null`,
  "echo FONT_INSTALL_OK",
].join(" && ");

// fc-scan + fc-match assert each face resolves to the EXACT installed file (fc-match always
// returns *something*, so assert the returned path — file presence alone is insufficient).
const FONT_FC_ASSERT = [
  "set -e",
  `fc-scan --format '%{family}|%{style}|%{weight}|%{slant}|%{postscriptname}|%{fontformat}\\n' ${FONT_DIR}/*.ttf`,
  ...FONTS.map((f) => `test "$(fc-match -f '%{file}' '${f.match}')" = "${FONT_DIR}/${f.ttf}"`),
  `test "$(cat /etc/lixtara-artifact-version)" = "${NEW_ARTIFACT_VERSION}"`,
  `test "$(cat /etc/lixtara-font-strategy)" = "${FONT_STRATEGY}"`,
  "echo FONT_FC_ASSERT_OK",
].join(" && ");

// Chromium proof (fail-closed): a Remotion still whose composition measures each system
// face's rendered width against the generic fallback and cancelRender()s if they match
// (= Chrome fell back). renderStill throws on cancelRender -> gate fails -> no snapshot.
// Each sample row is `alignSelf: flex-start` so its box shrinks to the TEXT width (a flex
// column stretches children to the container width by default — that was the harness bug
// that measured 852px for all rows). A full-width `sentinel` div (no alignSelf) measures the
// available content width so the harness can prove the rows actually shrank. Two DISTINCT
// failures: FONT_CHECK_HARNESS_INVALID (the measurement itself is untrustworthy) vs
// FONT_FALLBACK_DETECTED (a VALID comparison where the custom face is indistinguishable from
// the fallback). Tolerance is explicit — never float-equality.
const FONT_CHECK_ENTRY = `import React, { useRef, useState, useEffect } from "react";
import { registerRoot, Composition, AbsoluteFill, delayRender, continueRender, cancelRender } from "remotion";
const T = "Lixtara Homes 0123";
const MIN_FONT_WIDTH_DELTA_PX = 1; // custom vs fallback must differ by at least this
const Row = React.forwardRef((p, ref) => React.createElement("div", { ref, style: { alignSelf: "flex-start", fontFamily: p.ff, fontWeight: p.fw, fontStyle: p.fs || "normal", fontSize: 40, whiteSpace: "nowrap", color: "#0F172A" } }, T));
const Check = () => {
  const [h] = useState(() => delayRender("font-check"));
  const sentinel = useRef(null), pf = useRef(null), fbSerif = useRef(null), inter = useRef(null), fbSans = useRef(null);
  useEffect(() => { (async () => {
    await document.fonts.ready;
    const w = (r) => r.current.getBoundingClientRect().width;
    const avail = w(sentinel);
    const pfW = w(pf), serifW = w(fbSerif), interW = w(inter), sansW = w(fbSans);
    const s = [pfW, serifW, interW, sansW];
    // --- harness validity (distinct error; guards against misleading diagnostics) ---
    const finitePositive = s.every((x) => Number.isFinite(x) && x > 0);
    const allIdentical = s.every((x) => Math.abs(x - s[0]) < 1e-6);
    const anyAtContainer = s.some((x) => Math.abs(x - avail) < 1); // didn't shrink to content
    if (!finitePositive || allIdentical || anyAtContainer) {
      cancelRender(new Error("FONT_CHECK_HARNESS_INVALID avail=" + avail + " samples=" + JSON.stringify(s)));
      return;
    }
    // --- valid comparison: fallback detection (custom width ~ fallback width) ---
    const checks = [
      document.fonts.check('500 40px "Playfair Display"'),
      document.fonts.check('600 40px "Playfair Display"'),
      document.fonts.check('italic 500 40px "Playfair Display"'),
      document.fonts.check('600 40px "Inter"'),
    ];
    const pfDistinct = Math.abs(pfW - serifW) >= MIN_FONT_WIDTH_DELTA_PX;
    const inDistinct = Math.abs(interW - sansW) >= MIN_FONT_WIDTH_DELTA_PX;
    if (!pfDistinct || !inDistinct || !checks.every(Boolean)) {
      cancelRender(new Error("FONT_FALLBACK_DETECTED pf=" + pfW + " serif=" + serifW + " inter=" + interW + " sans=" + sansW + " checks=" + JSON.stringify(checks)));
      return;
    }
    continueRender(h);
  })(); }, []);
  return React.createElement(AbsoluteFill, { style: { backgroundColor: "#FDFCF8", padding: 24, display: "flex", flexDirection: "column", gap: 6 } },
    React.createElement("div", { ref: sentinel, style: { height: 0 } }),
    React.createElement(Row, { ref: pf, ff: '"Playfair Display"', fw: 500 }),
    React.createElement(Row, { ff: '"Playfair Display"', fw: 600 }),
    React.createElement(Row, { ff: '"Playfair Display"', fw: 500, fs: "italic" }),
    React.createElement(Row, { ref: inter, ff: '"Inter"', fw: 600 }),
    React.createElement(Row, { ref: fbSerif, ff: "serif", fw: 500 }),
    React.createElement(Row, { ref: fbSans, ff: "sans-serif", fw: 600 }));
};
registerRoot(() => React.createElement(Composition, { id: "FontCheck", component: Check, durationInFrames: 1, fps: 1, width: 900, height: 360 }));
`;
const FONT_CHECK_RENDER = `import path from "node:path";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill } from "@remotion/renderer";
const serveUrl = await bundle({ entryPoint: path.resolve("fontcheck-entry.jsx"), onProgress: () => {} });
const composition = await selectComposition({ serveUrl, id: "FontCheck" });
await renderStill({ composition, serveUrl, output: "/tmp/fontcheck.png" });
console.log("FONT_CHECK_RENDER_OK");
`;

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
  // snapshotExpiration: 0 => the resulting snapshot NEVER expires (SDK 2.6.1: "Use 0 for no
  // expiration"), so the bake produces a PERMANENT, production-candidate artifact rather than
  // the platform's default ~30-day TTL. See the runbook's retention/history note.
  const sandbox = await Sandbox.create({ runtime: "node24", resources: { vcpus: 4 }, snapshotExpiration: 0 });
  // Font source bytes + a `sha256sum -c` manifest (TTF-name -> F1-M hash) for the fail-closed
  // in-sandbox hash verify after conversion.
  const fontFiles = FONTS.map((f) => ({
    path: `fonts/${f.woff2}`,
    content: fs.readFileSync(path.join(FONTS_SRC_DIR, f.woff2)),
  }));
  const ttfSha256Manifest = FONTS.map((f) => `${f.sha256}  ${f.ttf}`).join("\n") + "\n";
  await sandbox.writeFiles([
    { path: "package.json", content: Buffer.from(BASE_PACKAGE_JSON, "utf8") },
    { path: "ensure-chromium.mjs", content: Buffer.from(ENSURE_CHROMIUM, "utf8") },
    { path: "smoke-entry.jsx", content: Buffer.from(SMOKE_ENTRY, "utf8") },
    { path: "render-smoke.mjs", content: Buffer.from(SMOKE_RENDER, "utf8") },
    { path: "fontcheck-entry.jsx", content: Buffer.from(FONT_CHECK_ENTRY, "utf8") },
    { path: "fontcheck-render.mjs", content: Buffer.from(FONT_CHECK_RENDER, "utf8") },
    { path: "fonts/ttf.sha256", content: Buffer.from(ttfSha256Manifest, "utf8") },
    ...fontFiles,
  ]);
  // Auditable, fail-closed gate runner: prints a START and a PASS/FAIL line per gate (name +
  // exit code + duration) followed by the tail-capped stdout/stderr as evidence. Behaviour is
  // otherwise UNCHANGED — a non-zero exit still throws before returning, so nothing downstream
  // (and no snapshot) can run after a failure. The gate COMMANDS already narrow their output to
  // the relevant evidence (head -1 / grep / cat the probe), so this never dumps a full build
  // log; the cap only bounds the large prep gates (npm/dnf/ffmpeg-install) and keeps the TAIL
  // (where node/ffmpeg/ffprobe banners, RENDER_SMOKE_OK, and the ffprobe fields land). No env
  // var or secret is ever printed — only each command's own stdout/stderr.
  const GATE_LOG_CAP = 4000;
  const capTail = (s) =>
    s.length > GATE_LOG_CAP ? `...(truncated to last ${GATE_LOG_CAP} chars)\n${s.slice(-GATE_LOG_CAP)}` : s;
  const indent = (s) => s.split("\n").map((l) => `    | ${l}`).join("\n");
  const sh = async (label, cmd, timeoutMs = 300000) => {
    console.log(`--- GATE START: ${label}`);
    const startNs = process.hrtime.bigint();
    const r = await sandbox.runCommand("sh", ["-c", cmd], { timeoutMs });
    const ms = Number(process.hrtime.bigint() - startNs) / 1e6;
    const out = (await r.stdout()).trim();
    const err = (await r.stderr()).trim();
    console.log(`--- GATE ${r.exitCode === 0 ? "PASS" : "FAIL"}: ${label} (exit=${r.exitCode}, ${ms.toFixed(0)}ms)`);
    if (out) console.log(`  stdout:\n${indent(capTail(out))}`);
    if (err) console.log(`  stderr:\n${indent(capTail(err))}`);
    if (r.exitCode !== 0) throw new Error(`gate ${label} failed (exit ${r.exitCode})`);
    return r;
  };

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

  // ---- F1-N system-font gates (fail-closed): install, verify hashes, fc resolution +
  // manifests, and a Chromium width-based proof that the render actually uses the faces. ----
  await sh("font-install", FONT_INSTALL);        // convert + hash-verify + install + fc-cache + manifests
  await sh("font-fc-assert", FONT_FC_ASSERT);    // fc-scan + fc-match exact-file + manifest contents
  await sh("font-check-render", "node fontcheck-render.mjs", 600000); // cancelRender()s on fallback
  const fontCheckPng = await sandbox.readFileToBuffer({ path: "/tmp/fontcheck.png" });
  if (!fontCheckPng || fontCheckPng.length === 0) throw new Error("font-check PNG missing");
  console.log("FONT_CHECK_PNG_BYTES=" + fontCheckPng.length);

  // ---- Only now, with ALL evidence green, capture the immutable artifact. snapshot() stops
  // the session as part of the process (no separate stop() needed). The emitted snapshotId is
  // recorded by the owner into CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID + a BASE_ARTIFACT_VERSION
  // bump as SEPARATE, later steps — NOT here.
  const snap = await sandbox.snapshot();
  console.log("SNAPSHOT_ID=" + snap.snapshotId);
  console.log("SNAPSHOT_SIZE_BYTES=" + snap.sizeBytes);
  console.log("ARTIFACT_VERSION=" + NEW_ARTIFACT_VERSION);
  return { snapshotId: snap.snapshotId, sizeBytes: snap.sizeBytes, artifactVersion: NEW_ARTIFACT_VERSION, fontCheckPng };
}
