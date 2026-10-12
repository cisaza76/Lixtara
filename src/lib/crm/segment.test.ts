import { describe, it, expect } from "vitest";
import { applySegment, parseSegment, segmentSelect, segmentToSearchParams } from "./segment";

describe("parseSegment", () => {
  it("keeps only known values", () => {
    expect(parseSegment({
      priority: "A", ownerType: "LLC", zip: "33133", pilotGroup: "Score",
      status: "Sin contactar", hasEmail: "yes",
    })).toEqual({
      priority: "A", ownerType: "LLC", zip: "33133", pilotGroup: "Score",
      status: "Sin contactar", hasEmail: "yes",
    });
    expect(parseSegment({
      priority: "Z", ownerType: "Robot", zip: "3313", pilotGroup: "x", status: "Hot", hasEmail: "maybe",
    })).toEqual({});
  });

  it("reads URLSearchParams, FormData and stored jsonb", () => {
    expect(parseSegment(new URLSearchParams("priority=B&zip=33101"))).toEqual({ priority: "B", zip: "33101" });
    const fd = new FormData();
    fd.set("pilotGroup", "Control");
    expect(parseSegment(fd)).toEqual({ pilotGroup: "Control" });
    expect(parseSegment(null)).toEqual({});
  });

  it("has no filter on signals or MLS status (mls_expirado stays out of the UI)", () => {
    expect(parseSegment({ signal: "mls_expirado", mls_status: "Expirado" })).toEqual({});
  });

  it("round-trips through search params", () => {
    const seg = { priority: "A", zip: "33133" } as const;
    expect(parseSegment(segmentToSearchParams(seg))).toEqual(seg);
  });
});

describe("segmentSelect / applySegment", () => {
  function recorder() {
    const calls: string[] = [];
    const q = {
      eq: (c: string, v: string) => (calls.push(`eq ${c} ${v}`), q),
      is: (c: string, v: null) => (calls.push(`is ${c} ${v}`), q),
      not: (c: string, o: string, v: null) => (calls.push(`not ${c} ${o} ${v}`), q),
    };
    return { q, calls };
  }

  it("ZIP needs the inner embed through current ownerships", () => {
    expect(segmentSelect("id", {})).toBe("id");
    expect(segmentSelect("id", { zip: "33133" })).toBe(
      "id,crm_property_owners!inner(valid_to,crm_properties!inner(zip))");
    const { q, calls } = recorder();
    applySegment(q, { zip: "33133" });
    expect(calls).toEqual([
      "eq crm_property_owners.crm_properties.zip 33133",
      "is crm_property_owners.valid_to null",
    ]);
  });

  it("maps every filter to its column", () => {
    const { q, calls } = recorder();
    applySegment(q, { priority: "A", ownerType: "Trust", pilotGroup: "Score", status: "Respondió", hasEmail: "yes" });
    expect(calls).toEqual([
      "eq priority A", "eq owner_type Trust", "eq pilot_group Score",
      "eq outreach_status Respondió", "not email is null",
    ]);
    const r2 = recorder();
    applySegment(r2.q, { hasEmail: "no" });
    expect(r2.calls).toEqual(["is email null"]);
  });
});
