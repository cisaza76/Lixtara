import { afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

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

describe("proxy: código de Eventos de prueba de Meta (?meta_test_code=)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const run = async (query: string) => {
    vi.mocked(updateSession).mockResolvedValue({ response: NextResponse.next() } as Awaited<ReturnType<typeof updateSession>>);
    return proxy(new NextRequest(`https://preview.lixtara.com/en/listing/new${query}`));
  };
  const cookieHeader = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith("lx_meta_test=")) ?? null;

  it("Preview: lo guarda en una cookie httpOnly, path /, un día", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const c = cookieHeader(await run("?meta_test_code=TEST80832"));
    expect(c).toMatch(/^lx_meta_test=TEST80832;/);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/Max-Age=86400/);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Secure/i);
  });
  it("Preview: con otro formato no escribe nada", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    for (const q of ["?meta_test_code=test80832", "?meta_test_code=TEST", "?meta_test_code=TEST12a", "?meta_test_code=%3Cscript%3E", ""]) {
      expect(cookieHeader(await run(q)), q).toBeNull();
    }
  });
  it("Production: el parámetro se ignora, no se escribe la cookie", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(cookieHeader(await run("?meta_test_code=TEST80832"))).toBeNull();
  });
});
