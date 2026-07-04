import { describe, it, expect } from "vitest";
import { KlingProvider, WanProvider } from "@/lib/media-intelligence/providers/stubs";
import { VeoVideoProvider } from "@/lib/media-intelligence/providers/veo";
import { ProviderNotConfiguredError } from "@/lib/media-intelligence/providers/types";
import type { MediaGenInput } from "@/lib/media-intelligence/providers/types";

const input: MediaGenInput = {
  capability: "video",
  strategy: {} as never,
  shots: [],
  prompts: [],
  deliverable: {
    id: "d", capability: "video", kind: "x", aspect: "16:9",
    platforms: [], status: "planned", specialistId: "s",
  },
};

describe("stub providers", () => {
  it("are reported unconfigured and throw on generate", async () => {
    const p = new KlingProvider();
    expect(p.isConfigured()).toBe(false);
    await expect(p.generate(input)).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    await expect(new WanProvider().generate(input)).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
  it("Veo adapter is video-only and not live in v1", async () => {
    const v = new VeoVideoProvider();
    expect(v.capabilities).toEqual(["video"]);
    await expect(v.generate(input)).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
});
