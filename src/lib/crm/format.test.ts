import { describe, expect, it } from "vitest";
import { CRM_TIME_ZONE, dateTime } from "./format";

describe("dateTime", () => {
  it("renders UTC instants in Miami time, whatever the server zone", () => {
    // 2026-10-14 02:09 UTC = 2026-10-13 10:09 PM EDT (UTC-4)
    expect(dateTime("en", "2026-10-14T02:09:25Z")).toBe("Oct 13, 2026, 10:09 PM");
    expect(dateTime("es", "2026-10-14T02:09:25Z")).toMatch(/13 oct 2026.*10:09/);
  });

  it("follows the switch to EST in November", () => {
    // 2026-11-10 03:00 UTC = 2026-11-09 10:00 PM EST (UTC-5)
    expect(dateTime("en", "2026-11-10T03:00:00Z")).toBe("Nov 9, 2026, 10:00 PM");
  });

  it("keeps the empty and invalid cases", () => {
    expect(dateTime("en", null)).toBe("—");
    expect(dateTime("en", "not a date")).toBe("—");
  });

  it("uses the same zone as transactional email", () => {
    expect(CRM_TIME_ZONE).toBe("America/New_York");
  });
});
