import { describe, it, expect } from "vitest";
import { selectProvider } from "@/lib/media-intelligence/providers";

describe("selectProvider", () => {
  it("falls back to mock when no live provider is allowed", () => {
    expect(selectProvider("video").id).toBe("mock");
    expect(selectProvider("voice").id).toBe("mock");
  });
  it("still returns mock when allowLive but nothing is configured (v1)", () => {
    expect(selectProvider("video", { allowLive: true }).id).toBe("mock");
  });
});
