import { describe, it, expect, beforeEach } from "vitest";
import { LISTING_STEP_SLUGS, listingStepEvent, track } from "@/lib/analytics";

describe("listingStepEvent", () => {
  it("names each of the 8 listing steps with a stable slug", () => {
    expect(LISTING_STEP_SLUGS).toHaveLength(8);
    expect(listingStepEvent(1, "es")).toEqual({
      event: "listing_step_view",
      step: 1,
      step_name: "address",
      lang: "es",
    });
    expect(listingStepEvent(8, "en").step_name).toBe("payment");
  });

  it("falls back for an out-of-range step", () => {
    expect(listingStepEvent(9, "en").step_name).toBe("step_9");
  });
});

describe("track", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });

  it("creates the dataLayer and pushes the event", () => {
    track({ event: "loui_open", lang: "en" });
    expect((globalThis as unknown as { window: Window }).window.dataLayer).toEqual([
      { event: "loui_open", lang: "en" },
    ]);
  });
});
