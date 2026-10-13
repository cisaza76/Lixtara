import { describe, it, expect } from "vitest";
import { withoutDashes } from "@/lib/ai";

describe("withoutDashes", () => {
  it("turns number ranges into words", () => {
    expect(withoutDashes("Open 9–11 daily")).toBe("Open 9 to 11 daily");
  });
  it("turns asides into commas and keeps sentence punctuation clean", () => {
    expect(withoutDashes("Bright home — updated kitchen — near the bay.")).toBe(
      "Bright home, updated kitchen, near the bay.",
    );
    expect(withoutDashes("Call ahead —.")).toBe("Call ahead.");
  });
  it("keeps hyphenated words", () => {
    expect(withoutDashes("A move-in-ready, 3-bedroom home")).toBe(
      "A move-in-ready, 3-bedroom home",
    );
  });
});
