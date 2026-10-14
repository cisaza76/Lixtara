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

  it("marca is_test fuera de Production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const insert = vi.fn().mockResolvedValue({ error: null });
    createService.mockReturnValue({
      from: (t: string) =>
        t === "properties"
          ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { is_test: false } }) }) }) }
          : { insert },
    });
    await recordFunnelEvent(input);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ is_test: true, event: "listing_paid" }));
    vi.unstubAllEnvs();
  });
});
