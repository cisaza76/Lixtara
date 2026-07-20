// Staging-layout tests for SandboxRemotionProvider — verify the ACTUAL file set staged
// into the sandbox (not that a copy fn was called). Guards the font-404 regression:
// src/remotion/fonts.ts loads `staticFile("fonts/…")`, whose files live in the repo's
// public/fonts/ (outside src/remotion/) and must be staged into the bundle's
// remotion/public/fonts/ or `loadFont()` 404s in-sandbox and the render fails.
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectRenderStagingFiles } from "@/lib/video-engine/render-provider";

const REPO = process.cwd();
const SRC_REMOTION = path.join(REPO, "src", "remotion");
const PUBLIC_FONTS = path.join(REPO, "public", "fonts");

async function stage() {
  const dir = await mkdtemp(path.join(tmpdir(), "f1f-staging-"));
  const asset = path.join(dir, "photo.png");
  await writeFile(asset, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // tiny PNG-ish
  return collectRenderStagingFiles({
    entryPointLocalDir: SRC_REMOTION,
    fontsLocalDir: PUBLIC_FONTS,
    localAssetPaths: [asset],
  });
}

// Fonts the composition actually references, derived from the source of truth.
async function referencedFonts(): Promise<string[]> {
  const src = await readFile(path.join(SRC_REMOTION, "fonts.ts"), "utf8");
  return [...src.matchAll(/staticFile\("fonts\/([^"]+)"\)/g)].map((m) => m[1]);
}

describe("render-provider staging: static fonts", () => {
  it("every font referenced by fonts.ts actually exists in public/fonts/", async () => {
    const refs = await referencedFonts();
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const bytes = await readFile(path.join(PUBLIC_FONTS, ref));
      expect(bytes.length, `${ref} must exist and be non-empty`).toBeGreaterThan(0);
    }
  });

  it("stages every referenced font under remotion/public/fonts/ with real bytes", async () => {
    const [{ files }, refs] = await Promise.all([stage(), referencedFonts()]);
    const byPath = new Map(files.map((f) => [f.path, f.content]));
    for (const font of refs) {
      const staged = byPath.get(`remotion/public/fonts/${font}`);
      expect(staged, `remotion/public/fonts/${font} must be staged`).toBeInstanceOf(Buffer);
      expect((staged as Buffer).length).toBeGreaterThan(0);
    }
  });

  it("regression: still stages composition source + the downloaded photo; remoteRefs correct; no test files", async () => {
    const { files, remoteRefs } = await stage();
    const paths = files.map((f) => f.path);
    expect(paths).toContain("remotion/index.ts");
    expect(paths).toContain("remotion/public/asset-0.png");
    expect(remoteRefs).toEqual(["asset-0.png"]);
    expect(paths.some((p) => p.endsWith(".test.ts") || p.endsWith(".test.tsx"))).toBe(false);
  });
});
