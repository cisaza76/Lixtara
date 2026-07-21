// The render seam: turns a normalized `inputProps` + local source Asset paths into
// rendered MP4 bytes. Two implementations:
//   - `FakeRenderProvider` — a fixed small buffer + metrics. Used by EVERY unit test in
//     this package; CI never opens a real Sandbox.
//   - `SandboxRemotionProvider` — the real integration, built directly on the P2.0
//     spike's validated approach (docs/superpowers/spikes/2026-07-15-p2.0-sandbox-render.md,
//     verdict PASS). NOT imported by any *.test.ts in this package, and NOT run as part
//     of authoring this module — the one real-Sandbox validation pass is controller-
//     driven, separately from this unit-test slice (see the task report).
//
// Neither class knows about Creative Jobs (`@/lib/creative-jobs`) — this module has no
// such import, by design (see produce-asset.ts's header note).
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Sandbox } from "@vercel/sandbox";
import { buildRenderManifest } from "@/lib/video-engine/manifest";
import { BASE_ARTIFACT_VERSION, RENDER_PROVIDER } from "@/lib/video-engine/versions";

export interface RenderInput {
  compositionId: string;
  templateVersion: string;
  // Local (host) filesystem paths to already-downloaded source Assets — never a
  // signed URL streamed through the whole render (requirement 3).
  localAssetPaths: string[];
  inputProps: unknown;
  traceId: string | null;
}

export interface RenderMediaMetrics {
  sandboxStartupMs: number;
  bundleMs: number;
  selectCompositionMs: number;
  renderMs: number;
}

export interface RenderMediaOutput {
  bytes: Buffer;
  mime: "video/mp4";
  provider: "vercel-sandbox";
  renderer: "remotion";
  bundleVersion: string;
  baseArtifactVersion: string;
  metrics: RenderMediaMetrics;
  // Raw ffprobe JSON (stdout of `ffprobe -print_format json -show_format
  // -show_streams`), captured INSIDE the Sandbox — where the prebuilt artifact already
  // has ffprobe — before the Sandbox stops. This is what QA parses (via the existing
  // pure `parseFfprobe`, qa.ts); no host-local ffprobe is ever shelled out to.
  ffprobeJson: string;
}

export interface RenderProvider {
  render(input: RenderInput): Promise<RenderMediaOutput>;
}

// Distinct from a generic render failure — thrown specifically when provisioning the
// Sandbox itself fails (before any Remotion code has run). Lets an orchestrator
// (src/lib/video-engine/pipeline.ts) map this to `SANDBOX_CREATE_FAILED` via
// `instanceof` rather than string-sniffing a provider-specific message.
export class SandboxCreateFailedError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SandboxCreateFailedError";
  }
}

// ---------------------------------------------------------------------------
// FakeRenderProvider — the only provider any unit test in this repo constructs.
// ---------------------------------------------------------------------------

// Not a decodable MP4 — every test that needs QA to pass injects a fake `runQa`
// (produce-asset.test.ts), so nothing here ever hits a real ffprobe.
const FAKE_MP4_BYTES = Buffer.from("FAKE-MP4-CONTENT-FOR-UNIT-TESTS-ONLY", "utf8");

// A canned, VALID ffprobe payload (mp4/h264/1920x1080/30fps) — the fixture's stand-in
// for what SandboxRemotionProvider's in-sandbox `ffprobe` call would capture for a real
// render. Tests that want QA to fail spoof this via the constructor's `overrides`.
export const FAKE_FFPROBE_JSON = JSON.stringify({
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1920,
      height: 1080,
      r_frame_rate: "30/1",
      duration: "13.500000",
    },
  ],
  format: {
    format_name: "mov,mp4,m4a,3gp,3g2,mj2",
    duration: "13.500000",
  },
});

export class FakeRenderProvider implements RenderProvider {
  readonly calls: RenderInput[] = [];

  constructor(private readonly overrides: Partial<RenderMediaOutput> = {}) {}

  async render(input: RenderInput): Promise<RenderMediaOutput> {
    this.calls.push(input);
    return {
      bytes: FAKE_MP4_BYTES,
      mime: "video/mp4",
      provider: "vercel-sandbox",
      renderer: "remotion",
      bundleVersion: "fake-bundle-v1",
      baseArtifactVersion: "fake-base-v1",
      metrics: {
        sandboxStartupMs: 1,
        bundleMs: 1,
        selectCompositionMs: 1,
        renderMs: 1,
      },
      ffprobeJson: FAKE_FFPROBE_JSON,
      ...this.overrides,
    };
  }
}

// ---------------------------------------------------------------------------
// SandboxRemotionProvider — real integration (spike-based, controller-run only).
// ---------------------------------------------------------------------------

export type SandboxBaseArtifact = { snapshotId: string } | { image: string };

export interface SandboxRemotionProviderOptions {
  // Prebuilt base (Node 24 + Chromium/OS libs + ffmpeg/ffprobe + xz + the pinned
  // Remotion packages baked in — spike report §3/§7). Deliberately required, not
  // defaulted to a stock runtime: `BASE_ARTIFACT_VERSION` is still
  // "unbaked-pending-prebuilt-base" as of this module's authoring, and silently
  // falling back to a stock runtime would reintroduce the npm-install-per-render cost
  // the whole prebuilt-base design exists to avoid (requirement 8).
  baseArtifact: SandboxBaseArtifact;
  baseArtifactVersion?: string; // defaults to versions.ts's BASE_ARTIFACT_VERSION
  vcpus?: number;
  timeoutMs?: number;
  // Local (host) paths to the Remotion composition source that gets shipped into the
  // sandbox each render (small; NOT baked into the base, since TEMPLATE_VERSION can
  // change independently of BASE_ARTIFACT_VERSION). Defaults to this repo's
  // src/remotion/ tree.
  entryPointLocalDir?: string;
}

const DEFAULT_ENTRY_POINT_DIR = path.join(process.cwd(), "src", "remotion");
// Fonts are base64-embedded in the composition source (src/remotion/fonts-data.ts) and
// loaded as data URIs, so nothing font-related needs staging into the bundle's publicDir
// anymore — that removed the in-sandbox HTTP font fetch (and its delayRender timeout).

// The script that runs INSIDE the sandbox: bundle() -> selectComposition() ->
// renderMedia({codec:"h264"}), same inputProps to both (per the spike's validated
// requirement). Mirrors spikes/p2.0-sandbox/src/render.mjs, generalized to read its
// composition id + inputProps from a JSON file instead of hardcoding one composition.
const RENDER_SCRIPT = `
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const [, , inputJsonPath, outPath, timingsPath] = process.argv;
  // The file at inputJsonPath is a RenderManifest (see manifest.ts) — the same
  // secret-free, versioned payload the unit tests validate, not a bespoke shape.
  const { technical, inputProps } = JSON.parse(fs.readFileSync(inputJsonPath, "utf8"));
  const { compositionId } = technical;

  const timings = { stages: {} };
  const t = (name, ms) => { timings.stages[name] = ms; };

  const entryPoint = path.join(__dirname, "remotion", "index.ts");
  const publicDir = path.join(__dirname, "remotion", "public");

  let bundleLocation;
  {
    const start = process.hrtime.bigint();
    bundleLocation = await bundle({ entryPoint, publicDir, onProgress: () => {} });
    t("bundle_ms", Number(process.hrtime.bigint() - start) / 1e6);
  }

  let composition;
  {
    const start = process.hrtime.bigint();
    composition = await selectComposition({ serveUrl: bundleLocation, id: compositionId, inputProps, delayRenderTimeoutInMilliseconds: 120000 });
    t("selectComposition_ms", Number(process.hrtime.bigint() - start) / 1e6);
  }

  {
    const start = process.hrtime.bigint();
    await renderMedia({ composition, serveUrl: bundleLocation, codec: "h264", outputLocation: outPath, inputProps, delayRenderTimeoutInMilliseconds: 120000 });
    t("renderMedia_ms", Number(process.hrtime.bigint() - start) / 1e6);
  }

  fs.writeFileSync(timingsPath, JSON.stringify(timings));
}

main().catch((err) => {
  console.error("RENDER_FAILED", err && err.stack ? err.stack : String(err));
  process.exit(1);
});
`;

// Recursively stages a local directory's files under `remoteDir` inside the sandbox.
// Skips test files — they add nothing to a render and only cost bytes/time to ship.
export async function collectDirFiles(localDir: string, remoteDir: string): Promise<{ path: string; content: Buffer }[]> {
  const entries = await readdir(localDir, { withFileTypes: true });
  const files: { path: string; content: Buffer }[] = [];
  for (const entry of entries) {
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
    const localPath = path.join(localDir, entry.name);
    const remotePath = `${remoteDir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await collectDirFiles(localPath, remotePath)));
    } else {
      files.push({ path: remotePath, content: await readFile(localPath) });
    }
  }
  return files;
}

// Reads each local (already-downloaded) source Asset and stages it into the bundle's
// `public/` dir under a stable name, so `<Img src>` in the composition can address it
// with a same-directory-relative reference at render time.
async function stageLocalAssets(
  localAssetPaths: string[],
): Promise<{ files: { path: string; content: Buffer }[]; remoteRefs: string[] }> {
  const files: { path: string; content: Buffer }[] = [];
  const remoteRefs: string[] = [];
  for (let i = 0; i < localAssetPaths.length; i++) {
    const local = localAssetPaths[i];
    const ext = path.extname(local) || ".jpg";
    const remoteName = `asset-${i}${ext}`;
    files.push({ path: `remotion/public/${remoteName}`, content: await readFile(local) });
    remoteRefs.push(remoteName);
  }
  return { files, remoteRefs };
}

// Assembles the full set of files staged into the sandbox for a render (composition
// source + downloaded source photos), plus the `remoteRefs` the caller needs to rewrite
// inputProps. Exported so the staging layout is unit-testable WITHOUT a real Sandbox —
// the render itself only adds render.mjs + the manifest on top of this. Fonts are NOT
// staged: they're base64-embedded in the composition source (fonts-data.ts) and loaded
// as data URIs, so they ride along in `compositionFiles`.
export async function collectRenderStagingFiles(opts: {
  entryPointLocalDir: string;
  localAssetPaths: string[];
}): Promise<{ files: { path: string; content: Buffer }[]; remoteRefs: string[] }> {
  const compositionFiles = await collectDirFiles(opts.entryPointLocalDir, "remotion");
  const { files: assetFiles, remoteRefs } = await stageLocalAssets(opts.localAssetPaths);
  return { files: [...compositionFiles, ...assetFiles], remoteRefs };
}

// `inputProps` is caller-shaped (unknown here on purpose — see manifest.ts). Rewrites
// every occurrence of a local host path to its staged, in-sandbox reference via a
// string round-trip rather than walking a specific schema, so this stays decoupled
// from `listingVideoInputSchema` (input.ts already owns that shape).
function rewriteLocalPathsToRemote(inputProps: unknown, localPaths: string[], remoteRefs: string[]): unknown {
  let json = JSON.stringify(inputProps ?? null);
  localPaths.forEach((local, i) => {
    const remote = remoteRefs[i];
    if (remote === undefined) return;
    json = json.split(local).join(remote);
  });
  return JSON.parse(json);
}

export class SandboxRemotionProvider implements RenderProvider {
  constructor(private readonly opts: SandboxRemotionProviderOptions) {}

  async render(input: RenderInput): Promise<RenderMediaOutput> {
    const metrics: RenderMediaMetrics = {
      sandboxStartupMs: 0,
      bundleMs: 0,
      selectCompositionMs: 0,
      renderMs: 0,
    };

    let sandbox: Sandbox | null = null;
    try {
      // ---- 1. sandbox from the prebuilt base (NO npm install here) ----
      const startupStart = Date.now();
      const resources = { vcpus: this.opts.vcpus ?? 4 };
      const timeout = this.opts.timeoutMs ?? 5 * 60 * 1000;
      try {
        sandbox =
          "snapshotId" in this.opts.baseArtifact
            ? await Sandbox.create({
                source: { type: "snapshot", snapshotId: this.opts.baseArtifact.snapshotId },
                resources,
                timeout,
              })
            : await Sandbox.create({ image: this.opts.baseArtifact.image, resources, timeout });
      } catch (err) {
        throw new SandboxCreateFailedError(err instanceof Error ? err.message : String(err), err);
      }
      metrics.sandboxStartupMs = Date.now() - startupStart;

      // ---- 2. copy composition source (fonts are embedded in it) + local assets in ----
      const entryPointLocalDir = this.opts.entryPointLocalDir ?? DEFAULT_ENTRY_POINT_DIR;
      const { files: stagedFiles, remoteRefs } = await collectRenderStagingFiles({
        entryPointLocalDir,
        localAssetPaths: input.localAssetPaths,
      });
      const remoteInputProps = rewriteLocalPathsToRemote(input.inputProps, input.localAssetPaths, remoteRefs);

      // The tested, secret-free RenderManifest (manifest.ts) IS what gets written into
      // the sandbox — not a parallel hand-built object. This is what makes
      // buildRenderManifest's secret-freedom/versions/traceId guarantees apply to what
      // actually ships, not just to what the manifest unit tests exercise in isolation.
      const manifest = buildRenderManifest({
        compositionId: input.compositionId,
        templateVersion: input.templateVersion,
        inputProps: remoteInputProps,
        traceId: input.traceId,
      });

      await sandbox.writeFiles([
        ...stagedFiles,
        { path: "render.mjs", content: Buffer.from(RENDER_SCRIPT, "utf8") },
        {
          path: "render-input.json",
          content: Buffer.from(JSON.stringify(manifest), "utf8"),
        },
      ]);

      // ---- 3. bundle -> selectComposition -> renderMedia (in-sandbox) ----
      // `sh -c` per the spike (§5.2): a missing/failing binary/script returns a clean
      // exit code instead of an opaque SDK 400.
      const result = await sandbox.runCommand(
        "sh",
        ["-c", "node render.mjs render-input.json /tmp/out.mp4 /tmp/timings.json"],
        { timeoutMs: timeout },
      );
      if (result.exitCode !== 0) {
        const stderr = await result.stderr();
        throw new Error(`SandboxRemotionProvider: render failed (exit ${result.exitCode}): ${stderr.slice(-4000)}`);
      }

      const timingsBuf = await sandbox.readFileToBuffer({ path: "/tmp/timings.json" });
      const timings = timingsBuf
        ? (JSON.parse(timingsBuf.toString("utf8")) as { stages?: Record<string, number> })
        : null;
      metrics.bundleMs = timings?.stages?.bundle_ms ?? metrics.bundleMs;
      metrics.selectCompositionMs = timings?.stages?.selectComposition_ms ?? metrics.selectCompositionMs;
      metrics.renderMs = timings?.stages?.renderMedia_ms ?? metrics.renderMs;

      // ---- 4. QA (ffprobe) INSIDE the sandbox, while the prebuilt artifact's ffprobe
      // is still reachable — AFTER renderMedia produced /tmp/out.mp4, BEFORE reading the
      // bytes back out or stopping the sandbox. `sh -c` per the spike (§5.2): a
      // missing/failing binary run directly returns an opaque SDK 400 instead of a clean
      // exit code. This is what makes QA never depend on a host-local `ffprobe` binary —
      // the worker's own runtime needs none (see worker-deps.ts's `defaultRunQa`, which
      // only parses this JSON).
      const ffprobeResult = await sandbox.runCommand(
        "sh",
        ["-c", "ffprobe -v error -print_format json -show_format -show_streams /tmp/out.mp4"],
        { timeoutMs: timeout },
      );
      if (ffprobeResult.exitCode !== 0) {
        const stderr = await ffprobeResult.stderr();
        throw new Error(
          `SandboxRemotionProvider: ffprobe failed (exit ${ffprobeResult.exitCode}): ${stderr.slice(-2000)}`,
        );
      }
      const ffprobeJson = await ffprobeResult.stdout();

      // ---- 5. read the rendered bytes back out ----
      const bytes = await sandbox.readFileToBuffer({ path: "/tmp/out.mp4" });
      if (!bytes) {
        throw new Error(
          "SandboxRemotionProvider: renderMedia reported success but /tmp/out.mp4 was not retrievable",
        );
      }

      return {
        bytes,
        mime: "video/mp4",
        provider: RENDER_PROVIDER,
        renderer: "remotion",
        bundleVersion: input.templateVersion,
        baseArtifactVersion: this.opts.baseArtifactVersion ?? BASE_ARTIFACT_VERSION,
        metrics,
        ffprobeJson,
      };
    } finally {
      // Requirement 9: stop() in `finally` on success, error, AND timeout. A failed
      // stop must not mask the original render error/result.
      if (sandbox) {
        await sandbox.stop().catch(() => {});
      }
    }
  }
}
