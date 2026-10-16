import { describe, it, expect } from "vitest";
import { inProgressCount } from "@/lib/dashboard-stats";

describe("inProgressCount (panel: “En proceso”)", () => {
  it("cuenta borradores y listings pagados esperando a la broker", () => {
    const listings = [
      { mls_status: "draft" },
      { mls_status: "pending_approval" },
      { mls_status: "active" },
      { mls_status: "withdrawn" },
      { mls_status: null },
    ];
    expect(inProgressCount(listings)).toBe(2);
  });
  it("un solo listing pagado en revisión ya no da 0", () => {
    expect(inProgressCount([{ mls_status: "pending_approval" }])).toBe(1);
  });
});
