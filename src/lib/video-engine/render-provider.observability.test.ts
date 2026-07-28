import { vi, describe, it, expect, beforeEach } from "vitest";

// Fake @vercel/sandbox: font guard passes, install passes, render command behavior is
// configurable per test (exit code + how long the fake clock advances while it "runs").
const h = vi.hoisted(() => {
  const state = {
    renderExit: 0,
    renderElapsedMs: 1000,
    clock: { t: 0 },
    name: "sbx_fake_123",
  };
  const fakeSandbox = {
    get name() {
      return state.name;
    },
    get region() {
      return "iad1";
    },
    async runCommand(_bin: string, args: string[]) {
      const cmd = args[1] ?? "";
      if (cmd.includes("lixtara-artifact-version")) {
        return {
          exitCode: 0,
          stdout: async () => "VERSION=base-test\nSTRATEGY=system\nFACES=OK\n",
          stderr: async () => "",
        };
      }
      if (cmd.includes("render.mjs")) {
        state.clock.t += state.renderElapsedMs;
        return { exitCode: state.renderExit, stdout: async () => "", stderr: async () => "render stderr tail" };
      }
      if (cmd.includes("ffprobe")) {
        return { exitCode: 0, stdout: async () => JSON.stringify({ streams: [], format: {} }), stderr: async () => "" };
      }
      return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
    },
    async writeFiles() {},
    async readFileToBuffer(p: { path: string }) {
      if (p.path.includes("timings")) return Buffer.from(JSON.stringify({ stages: {} }));
      return Buffer.from("mp4-bytes");
    },
    async stop() {},
  };
  return { state, fakeSandbox };
});

vi.mock("@vercel/sandbox", () => ({
  Sandbox: { create: async () => h.fakeSandbox },
}));

vi.mock("@/lib/video-engine/font-guard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/video-engine/font-guard")>();
  return {
    ...mod,
    buildFontGuardCommand: () => "echo lixtara-artifact-version",
    parseFontGuardOutput: () => ({}),
    evaluateFontGuard: () => ({ ok: true }),
  };
});

import { RenderTimeoutError, SandboxRemotionProvider, type RenderInput } from "@/lib/video-engine/render-provider";

function input(overrides: Partial<RenderInput> = {}): RenderInput {
  return {
    compositionId: "ListingVideo",
    templateVersion: "2",
    localAssetPaths: [],
    inputProps: { badge: null },
    traceId: "trace-obs",
    ...overrides,
  };
}

describe("#112 — SandboxRemotionProvider observability", () => {
  beforeEach(() => {
    h.state.renderExit = 0;
    h.state.renderElapsedMs = 1000;
    h.state.clock.t = 0;
  });

  it("reports the sandbox identity through onSandboxIdentity once the sandbox exists", async () => {
    const provider = new SandboxRemotionProvider({
      baseArtifact: { snapshotId: "snap_test" },
      timeoutMs: 60_000,
      now: () => (h.state.clock.t += 1),
    });
    const seen: import("@/lib/video-engine/render-provider").SandboxIdentity[] = [];
    await provider.render(input({ onSandboxIdentity: (id) => void seen.push(id) }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ sandboxId: "sbx_fake_123", region: "iad1", snapshotId: "snap_test" });
  });

  it("a render command SIGKILLed at the budget boundary → typed RenderTimeoutError", async () => {
    h.state.renderExit = 137;
    h.state.renderElapsedMs = 60_000; // consumes the whole budget on the fake clock
    const provider = new SandboxRemotionProvider({
      baseArtifact: { snapshotId: "snap_test" },
      timeoutMs: 60_000,
      now: () => h.state.clock.t,
    });
    await expect(provider.render(input())).rejects.toBeInstanceOf(RenderTimeoutError);
  });

  it("a fast non-zero exit stays a plain render failure (NOT sniffed into timeout)", async () => {
    h.state.renderExit = 1;
    h.state.renderElapsedMs = 500;
    const provider = new SandboxRemotionProvider({
      baseArtifact: { snapshotId: "snap_test" },
      timeoutMs: 60_000,
      now: () => h.state.clock.t,
    });
    const err = await provider.render(input()).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RenderTimeoutError);
    expect(String(err.message)).toContain("render failed (exit 1)");
  });

  it("a throwing onSandboxIdentity callback never breaks the render (non-regression)", async () => {
    const provider = new SandboxRemotionProvider({
      baseArtifact: { snapshotId: "snap_test" },
      timeoutMs: 60_000,
      now: () => (h.state.clock.t += 1),
    });
    const out = await provider.render(
      input({
        onSandboxIdentity: () => {
          throw new Error("observer bug");
        },
      }),
    );
    expect(out.bytes.length).toBeGreaterThan(0);
  });
});
