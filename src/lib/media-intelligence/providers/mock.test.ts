import { describe, it, expect } from "vitest";
import { MockProvider } from "@/lib/media-intelligence/providers/mock";
import type { MediaGenInput } from "@/lib/media-intelligence/providers/types";
import { MEDIA_CAPABILITIES } from "@/lib/media-intelligence/types";

function input(capability: (typeof MEDIA_CAPABILITIES)[number]): MediaGenInput {
  return {
    capability,
    strategy: {} as never,
    shots: [],
    prompts: [],
    deliverable: {
      id: "d1", capability, kind: "x", aspect: "16:9",
      platforms: [], status: "planned", specialistId: "s1",
    },
  };
}

describe("MockProvider", () => {
  const p = new MockProvider();
  it("is always configured and covers every capability", () => {
    expect(p.isConfigured()).toBe(true);
    for (const c of MEDIA_CAPABILITIES) expect(p.capabilities).toContain(c);
  });
  it("returns a mock deliverable with no real url", async () => {
    const r = await p.generate(input("video"));
    expect(r.status).toBe("mock");
    expect(r.url).toBeNull();
    expect(r.provider).toBe("mock");
    expect(r.deliverableId).toBe("d1");
  });
});
