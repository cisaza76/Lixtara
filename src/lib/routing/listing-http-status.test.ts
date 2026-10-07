import { describe, it, expect, afterEach, vi } from "vitest";
import {
  fetchListingVisibility,
  listingDetailErrorStatus,
  listingErrorHtml,
  listingHttpStatus,
  matchListingDetailPath,
} from "./listing-http-status";

const ID = "2da3ae77-7dd1-4e95-88a8-3e0a1ff97c3f";

describe("listingHttpStatus (#135)", () => {
  it.each([
    [null, 404],
    [{ mls_status: "active", is_test: false }, 200],
    [{ mls_status: "active", is_test: true }, 404],
    [{ mls_status: "withdrawn", is_test: false }, 410],
    [{ mls_status: "expired", is_test: false }, 410],
    [{ mls_status: "closed", is_test: false }, 410],
    [{ mls_status: "withdrawn", is_test: true }, 404], // no revelar que existe
    [{ mls_status: "draft", is_test: false }, 404],
    [{ mls_status: "pending_approval", is_test: false }, 404],
    [{ mls_status: "under_contract", is_test: false }, 404],
  ] as const)("%j → %i", (row, expected) => {
    expect(listingHttpStatus(row)).toBe(expected);
  });
});

describe("listingDetailErrorStatus", () => {
  it("id que no es UUID → 404 sin consultar", async () => {
    const lookup = vi.fn();
    expect(await listingDetailErrorStatus("abc", lookup)).toBe(404);
    expect(lookup).not.toHaveBeenCalled();
  });
  it("activo → null (sigue a la página)", async () => {
    expect(await listingDetailErrorStatus(ID, async () => ({ mls_status: "active", is_test: false }))).toBeNull();
  });
  it("retirado → 410; inexistente → 404", async () => {
    expect(await listingDetailErrorStatus(ID, async () => ({ mls_status: "withdrawn", is_test: false }))).toBe(410);
    expect(await listingDetailErrorStatus(ID, async () => null)).toBe(404);
  });
  it("consulta fallida → null (nunca 5xx; decide la página)", async () => {
    expect(await listingDetailErrorStatus(ID, async () => undefined)).toBeNull();
  });
});

describe("matchListingDetailPath", () => {
  it("solo la ficha, en ambos idiomas", () => {
    expect(matchListingDetailPath(`/en/property/${ID}`)).toEqual({ lang: "en", id: ID });
    expect(matchListingDetailPath(`/es/property/${ID}/`)).toEqual({ lang: "es", id: ID });
    expect(matchListingDetailPath(`/en/properties`)).toBeNull();
    expect(matchListingDetailPath(`/en/property/${ID}/edit`)).toBeNull();
  });
});

describe("fetchListingVisibility", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("sin env → undefined", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(await fetchListingVisibility(ID)).toBeUndefined();
  });

  it("consulta solo mls_status,is_test con la clave de servidor", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([{ mls_status: "withdrawn", is_test: false }]), { status: 200 }),
    );
    const row = await fetchListingVisibility(ID, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(row).toEqual({ mls_status: "withdrawn", is_test: false });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://x.supabase.co/rest/v1/properties?id=eq.${ID}&select=mls_status,is_test&limit=1`);
    expect((init.headers as Record<string, string>).apikey).toBe("sb_secret_test");
  });

  it("fila ausente → null; error HTTP o de red → undefined", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "k";
    const empty = vi.fn(async () => new Response("[]", { status: 200 }));
    expect(await fetchListingVisibility(ID, { fetchImpl: empty as unknown as typeof fetch })).toBeNull();
    const bad = vi.fn(async () => new Response("x", { status: 500 }));
    expect(await fetchListingVisibility(ID, { fetchImpl: bad as unknown as typeof fetch })).toBeUndefined();
    const boom = vi.fn(async () => { throw new Error("net"); });
    expect(await fetchListingVisibility(ID, { fetchImpl: boom as unknown as typeof fetch })).toBeUndefined();
  });
});

describe("listingErrorHtml", () => {
  it("lleva noindex y ningún dato del listing", () => {
    for (const s of [404, 410] as const) {
      for (const l of ["en", "es"] as const) {
        const html = listingErrorHtml(l, s);
        expect(html).toContain('<meta name="robots" content="noindex">');
        expect(html).toContain(`href="/${l}/properties"`);
        expect(html).not.toMatch(/\$|address|bedrooms/i);
      }
    }
  });
});
