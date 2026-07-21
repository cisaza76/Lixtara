// Staging-layout tests for SandboxRemotionProvider — verify the ACTUAL file set staged
// into the sandbox (not that a copy fn was called). Fonts are base64-embedded in the
// composition source (src/remotion/fonts-data.ts) and loaded as data URIs, so they ride
// along in the composition-source copy — nothing font-specific is staged into publicDir.
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectRenderStagingFiles } from "@/lib/video-engine/render-provider";

const REPO = process.cwd();
const SRC_REMOTION = path.join(REPO, "src", "remotion");

async function stage() {
  const dir = await mkdtemp(path.join(tmpdir(), "staging-"));
  const asset = path.join(dir, "photo.png");
  await writeFile(asset, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // tiny PNG-ish
  return collectRenderStagingFiles({
    entryPointLocalDir: SRC_REMOTION,
    localAssetPaths: [asset],
  });
}

describe("render-provider staging", () => {
  it("ships the composition source incl. the embedded-font module + the downloaded photo; remoteRefs correct; no test files", async () => {
    const { files, remoteRefs } = await stage();
    const paths = files.map((f) => f.path);

    expect(paths).toContain("remotion/index.ts");
    expect(paths).toContain("remotion/fonts.ts");
    // The embedded fonts ride along inside the composition source — this is what replaces
    // the old public/fonts/ staging and keeps loadFont() network-free in the sandbox.
    expect(paths).toContain("remotion/fonts-data.ts");
    expect(paths).toContain("remotion/public/asset-0.png");
    expect(remoteRefs).toEqual(["asset-0.png"]);

    // Nothing is staged under a fonts/ publicDir anymore.
    expect(paths.some((p) => p.startsWith("remotion/public/fonts/"))).toBe(false);
    // Test files never ship.
    expect(paths.some((p) => p.endsWith(".test.ts") || p.endsWith(".test.tsx"))).toBe(false);
  });
});
