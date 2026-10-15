import { afterEach, describe, expect, it, vi } from "vitest";

const createService = vi.fn();
vi.mock("@/lib/supabase/service", () => ({ createService: () => createService() }));

import { recordFunnelEvent } from "@/lib/funnel-events.server";

const input = { event: "listing_paid", propertyId: "p1", step: 8, livemode: true } as const;

describe("recordFunnelEvent nunca lanza (no puede volver 500 el webhook de Stripe)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("si el cliente de Supabase no se puede crear", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    createService.mockImplementation(() => {
      throw new Error("Supabase service env vars missing");
    });
    await expect(recordFunnelEvent(input)).resolves.toBeUndefined();
  });

  it("si la consulta o el insert fallan (p. ej. migración sin aplicar: columna is_test inexistente)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const insert = vi.fn().mockResolvedValue({ error: { code: "PGRST204", message: "is_test" } });
    createService.mockReturnValue({
      from: (t: string) =>
        t === "properties"
          ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.reject(new Error("network")) }) }) }
          : { insert },
    });
    await expect(recordFunnelEvent(input)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  // funnel_events: insert + la lectura del último evento con lang.
  function eventsTable(insert: ReturnType<typeof vi.fn>, lastLang: string | null = null) {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "order", "limit"]) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: lastLang ? { metadata: { lang: lastLang } } : null });
    return { ...q, insert };
  }

  it("marca is_test fuera de Production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const insert = vi.fn().mockResolvedValue({ error: null });
    createService.mockReturnValue({
      from: (t: string) =>
        t === "properties"
          ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { is_test: false } }) }) }) }
          : eventsTable(insert),
    });
    await recordFunnelEvent(input);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ is_test: true, event: "listing_paid" }));
    vi.unstubAllEnvs();
  });

  it("sin lang: primero el del último evento del listing, luego el del vendedor (seller_leads)", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const insert = vi.fn().mockResolvedValue({ error: null });
    const leadEq = vi.fn(() => ({ maybeSingle: () => Promise.resolve({ data: { locale: "en" } }) }));
    const db = (lastLang: string | null) => ({
      from: (t: string) =>
        t === "properties"
          ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { is_test: true, owner_id: "u1" } }) }) }) }
          : t === "seller_leads"
            ? { select: () => ({ eq: leadEq }) }
            : eventsTable(insert, lastLang),
    });

    // 1) Hay un evento previo con lang (p. ej. checkout_started desde la página): gana.
    createService.mockReturnValue(db("es"));
    await recordFunnelEvent({ event: "broker_countersigned", propertyId: "p1", step: 7 });
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: { lang: "es" }, step: 7 }));
    expect(leadEq).not.toHaveBeenCalled();

    // 2) Ningún evento previo con lang: el de seller_leads.
    createService.mockReturnValue(db(null));
    await recordFunnelEvent({ event: "agreement_signed", propertyId: "p1", step: 7 });
    expect(leadEq).toHaveBeenCalledWith("user_id", "u1");
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: { lang: "en" } }));

    // 3) Un lang explícito (la página del paso o la metadata de Stripe) gana y no consulta nada.
    leadEq.mockClear();
    createService.mockReturnValue(db("es"));
    await recordFunnelEvent({ event: "listing_paid", propertyId: "p1", step: 8, metadata: { lang: "en" } });
    expect(leadEq).not.toHaveBeenCalled();
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: { lang: "en" } }));
    vi.unstubAllEnvs();
  });
});
