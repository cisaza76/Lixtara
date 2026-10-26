import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/middleware", () => ({ updateSession: vi.fn() }));
vi.mock("@/lib/routing/listing-http-status", async (orig) => ({
  ...(await orig<typeof import("@/lib/routing/listing-http-status")>()),
  listingDetailErrorStatus: vi.fn(async () => null),
}));

const { proxy } = await import("./proxy");

describe("proxy: redirección de rutas sin idioma", () => {
  it.each([
    ["/", "https://lixtara.com/en"],
    ["/about", "https://lixtara.com/en/about"],
    ["/properties?beds=3", "https://lixtara.com/en/properties?beds=3"],
  ])("%s → %s con 308 (permanente)", async (path, location) => {
    const res = await proxy(new NextRequest(`https://lixtara.com${path}`));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(location);
  });

  it("los slugs en español siguen con 308", async () => {
    const res = await proxy(new NextRequest("https://lixtara.com/servicios"));
    expect(res.status).toBe(308);
  });
});
