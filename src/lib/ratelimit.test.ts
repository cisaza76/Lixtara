import { describe, it, expect } from "vitest";
import { clientIp } from "@/lib/ratelimit";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://lixtara.vercel.app/api/loui", { headers });
}

describe("clientIp", () => {
  it("returns the first hop of x-forwarded-for", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.10.11.12" }))).toBe(
      "1.2.3.4",
    );
  });

  it("trims whitespace around the first hop", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "  1.2.3.4 , 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    expect(clientIp(reqWith({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("returns 'unknown' when no IP headers are present", () => {
    expect(clientIp(reqWith({}))).toBe("unknown");
  });
});
