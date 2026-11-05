import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: { id: "staff-1" } as { id: string } | null, staff: true, sessionReads: 0 }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        state.sessionReads++;
        return { data: { user: state.user } };
      },
    },
  }),
}));
vi.mock("@/lib/admin-auth", () => ({ isStaff: async () => state.staff }));
vi.mock("@/lib/ratelimit", () => ({ apiLimiter: () => null, enforceLimit: async () => null }));
const resend = vi.hoisted(() => vi.fn());
vi.mock("@/lib/meta-capi.server", () => ({ resendTestEvents: resend }));

import { POST } from "./route";

const LISTING = "968c406f-af9d-4dec-9646-bf4533a582ea";
const call = (body: unknown) =>
  POST(new Request("https://preview.lixtara.com/api/meta/test-events", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  state.user = { id: "staff-1" };
  state.staff = true;
  state.sessionReads = 0;
  resend.mockReset();
  resend.mockResolvedValue([{ name: "Lead", event_id: "lead_x", sent: true, status: 200, events_received: 1, fbtrace_id: "T", error: null }]);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/meta/test-events", () => {
  it("fuera de Preview: 404 sin leer la sesión ni enviar nada", async () => {
    for (const env of ["production", "development", ""]) {
      vi.stubEnv("VERCEL_ENV", env);
      expect((await call({ listing_id: LISTING, test_event_code: "TEST80832" })).status).toBe(404);
    }
    expect(state.sessionReads).toBe(0);
    expect(resend).not.toHaveBeenCalled();
  });
  it("sin sesión 401; sin rol de staff 403", async () => {
    state.user = null;
    expect((await call({ listing_id: LISTING, test_event_code: "TEST80832" })).status).toBe(401);
    state.user = { id: "seller-1" };
    state.staff = false;
    expect((await call({ listing_id: LISTING, test_event_code: "TEST80832" })).status).toBe(403);
    expect(resend).not.toHaveBeenCalled();
  });
  it("valida el id y el código (TEST + dígitos)", async () => {
    expect((await call({ listing_id: "x", test_event_code: "TEST80832" })).status).toBe(400);
    expect((await call({ listing_id: LISTING, test_event_code: "test80832" })).status).toBe(400);
    expect((await call({ listing_id: LISTING })).status).toBe(400);
    expect(resend).not.toHaveBeenCalled();
  });
  it("listing que no es is_test (o CAPI apagada): 409", async () => {
    resend.mockResolvedValue("not_allowed");
    expect((await call({ listing_id: LISTING, test_event_code: "TEST80832" })).status).toBe(409);
  });
  it("staff en Preview: reenvía y devuelve la respuesta de Meta por evento", async () => {
    const res = await call({ listing_id: LISTING, test_event_code: "TEST80832" });
    expect(res.status).toBe(200);
    expect(resend).toHaveBeenCalledWith(LISTING, "TEST80832");
    expect(await res.json()).toMatchObject({ listing_id: LISTING, test_event_code: "TEST80832", events: [{ name: "Lead", status: 200, events_received: 1 }] });
  });
});
