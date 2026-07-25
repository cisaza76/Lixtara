import { vi, describe, it, expect, beforeEach } from "vitest";

// Fake @vercel/sandbox that records the commands it runs and answers the font-guard probe
// as an OLD snapshot (no /etc/lixtara-* manifests => VERSION/STRATEGY MISSING). vi.hoisted
// so the mock factory (hoisted above imports) can reference it.
const h = vi.hoisted(() => {
  const commands: string[] = [];
  const fakeSandbox = {
    async runCommand(_bin: string, args: string[]) {
      const cmd = args[1] ?? "";
      commands.push(cmd);
      if (cmd.includes("lixtara-artifact-version")) {
        return { exitCode: 0, stdout: async () => "VERSION=MISSING\nSTRATEGY=MISSING\n", stderr: async () => "" };
      }
      return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
    },
    async writeFiles() {},
    async readFileToBuffer() {
      return Buffer.from("mp4");
    },
    async stop() {},
  };
  return { commands, fakeSandbox };
});

vi.mock("@vercel/sandbox", () => ({
  Sandbox: { create: async () => h.fakeSandbox },
}));

import { SandboxRemotionProvider, type RenderInput } from "@/lib/video-engine/render-provider";
import { FontStrategyMismatchError } from "@/lib/video-engine/font-guard";

describe("SandboxRemotionProvider — fail-closed font guard runs BEFORE the renderer", () => {
  beforeEach(() => {
    h.commands.length = 0;
  });

  it("system code + a snapshot without system fonts → FontStrategyMismatchError, render command never runs", async () => {
    const provider = new SandboxRemotionProvider({ baseArtifact: { snapshotId: "snap_old_no_fonts" } });
    const input: RenderInput = {
      compositionId: "ListingVideo",
      templateVersion: "1",
      localAssetPaths: ["/tmp/a.jpg"],
      inputProps: { photos: [{ url: "/tmp/a.jpg" }], badge: null },
      traceId: "t1",
    };

    await expect(provider.render(input)).rejects.toBeInstanceOf(FontStrategyMismatchError);

    // The guard ran; the actual render command (node render.mjs) never did — fail-closed.
    expect(h.commands.some((c) => c.includes("lixtara-artifact-version"))).toBe(true);
    expect(h.commands.some((c) => c.includes("render.mjs"))).toBe(false);
  });
});
