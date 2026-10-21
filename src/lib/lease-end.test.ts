// Paso 3 con inquilino: fecha de fin del alquiler MM/DD/YYYY y futura, o «No la sé».
import { describe, it, expect } from "vitest";
import { isoToUsDate, parseLeaseEnd, todayInMiami, usDateToIso } from "./lease-end";

const now = new Date("2026-10-21T03:30:00Z"); // 20 de octubre, 23:30 en Miami

describe("fecha de fin del alquiler", () => {
  it("MM/DD/YYYY futura → ISO", () => {
    expect(parseLeaseEnd("12/31/2026", false, now)).toEqual({ ok: true, iso: "2026-12-31" });
    expect(parseLeaseEnd("1/5/2027", false, now)).toEqual({ ok: true, iso: "2027-01-05" });
  });
  it("«No la sé» → vacía, sin fecha", () => {
    expect(parseLeaseEnd("", true, now)).toEqual({ ok: true, iso: null });
    expect(parseLeaseEnd("12/31/2026", true, now)).toEqual({ ok: true, iso: null });
  });
  it("vacía sin «No la sé», formato DD/MM, fecha imposible o pasada → error", () => {
    expect(parseLeaseEnd("", false, now)).toEqual({ ok: false, error: "lease_end_required" });
    expect(parseLeaseEnd("31/12/2026", false, now)).toEqual({ ok: false, error: "lease_end_invalid" });
    expect(parseLeaseEnd("02/30/2027", false, now)).toEqual({ ok: false, error: "lease_end_invalid" });
    expect(parseLeaseEnd("2026-12-31", false, now)).toEqual({ ok: false, error: "lease_end_invalid" });
    expect(parseLeaseEnd("10/20/2026", false, now)).toEqual({ ok: false, error: "lease_end_past" }); // hoy en Miami
    expect(parseLeaseEnd("10/21/2026", false, now)).toEqual({ ok: true, iso: "2026-10-21" });
  });
  it("utilidades", () => {
    expect(todayInMiami(now)).toBe("2026-10-20");
    expect(usDateToIso("12/31/2026")).toBe("2026-12-31");
    expect(isoToUsDate("2026-12-31")).toBe("12/31/2026");
    expect(isoToUsDate(null)).toBe("");
  });
});
