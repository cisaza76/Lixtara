// Creative Studio — Sandbox base artifact BAKE recipe (v2, hardened). NOT run against
// production here. Prepares ONE Vercel Sandbox with everything the per-render worker needs
// baked in; the owner then snapshots it -> CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID.
//
// Derived from the validated Gate B2 spike (docs/superpowers/spikes/2026-07-15-p2.0-sandbox
// -render.md, PASS), with three hardening deltas:
//   1. Bakes @remotion/fonts@4.0.489 (the real composition loads vendored fonts; spike omitted).
//   2. React aligned to the APP's 19.2.4 (Remotion 4.0.489 peer is react>=16.8.0; the
//      composition uses no React-18/19-only API — so aligning removes the spike's 18.3.1 drift).
//   3. ffmpeg/ffprobe PINNED: exact version + fixed URL + fail-closed SHA-256 verify (no "latest").
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
  version: "7.0.2",       // <-- PIN the exact version chosen
  url: "https://<FIXED-IMMUTABLE-URL>/ffmpeg-7.0.2-amd64-static.tar.xz", // <-- PIN a versioned, immutable URL
  sha256: "<PIN: sha256 of the file at FFMPEG.url — set before any bake; do not leave blank>",
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
  'sudo cp "/tmp/$DIR/ffmpeg" "/tmp/$DIR/ffprobe" /usr/local/bin/',
  "sudo chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe",
].join(" && ");

const ENSURE_CHROMIUM = `import { ensureBrowser } from "@remotion/renderer"; await ensureBrowser(); console.log("CHROMIUM_OK");`;
const BASE_PACKAGE_JSON = JSON.stringify(
  { name: "creative-studio-sandbox-base", private: true, type: "module", dependencies: PINNED }, null, 2);

export async function bake() {
  if (FFMPEG.sha256.startsWith("<PIN")) throw new Error("bake refused: FFMPEG.sha256 not pinned");
  const sandbox = await Sandbox.create({ runtime: "node24", resources: { vcpus: 4 } });
  await sandbox.writeFiles([
    { path: "package.json", content: Buffer.from(BASE_PACKAGE_JSON, "utf8") },
    { path: "ensure-chromium.mjs", content: Buffer.from(ENSURE_CHROMIUM, "utf8") },
  ]);
  const sh = (label, cmd, timeoutMs = 300000) =>
    sandbox.runCommand("sh", ["-c", cmd], { timeoutMs }).then(async (r) => {
      if (r.exitCode !== 0) throw new Error(`${label} failed (exit ${r.exitCode}): ${(await r.stderr()).slice(-2000)}`);
      return r;
    });
  await sh("npm-install", "npm install --no-audit --no-fund");
  await sh("chromium-os-deps", CHROMIUM_DEPS);
  await sh("ensure-chromium", "node ensure-chromium.mjs");
  await sh("ffmpeg-pinned", FFMPEG_INSTALL);   // fail-closed on checksum mismatch
  await sh("verify-ffprobe", "ffprobe -version | head -1");
  await sh("verify-node", "node --version");
  // OWNER STEP (not in Step 0): snapshot -> record snapshotId + bump BASE_ARTIFACT_VERSION.
  await sandbox.stop();
}
