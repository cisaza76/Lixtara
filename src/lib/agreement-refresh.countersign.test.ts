import { beforeEach, describe, expect, it, vi } from "vitest";

const recordFunnelEvent = vi.fn(async () => {});
const getEnvelopeStatus = vi.fn();
const getEnvelopeSigners = vi.fn();
let updatedRows: { id: string }[] = [{ id: "a1" }];

vi.mock("@/lib/funnel-events.server", () => ({ recordFunnelEvent }));
vi.mock("@/lib/email", () => ({ sendAgreementSigned: vi.fn(async () => {}) }));
vi.mock("@/lib/email-recipient-lang", () => ({ lookupRecipientLang: vi.fn(async () => "en") }));
vi.mock("@/lib/docusign", async (orig) => ({
  ...(await orig<typeof import("@/lib/docusign")>()),
  getEnvelopeStatus,
  getEnvelopeSigners,
}));
vi.mock("@/lib/supabase/service", () => {
  const chain = {
    update: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: null }),
    then: (r: (v: unknown) => unknown) => r({ data: updatedRows }),
  };
  return { createService: () => ({ from: () => chain, auth: { admin: { getUserById: async () => ({ data: { user: null } }) } } }) };
});

const { refreshAgreement } = await import("@/lib/agreement-refresh");
const seller = { roleName: "Seller", clientUserId: "p1", email: "s@example.com", status: "completed" };
const broker = { roleName: "Broker", email: "anamaria@lixtara.com", status: "completed" };
const events = () => recordFunnelEvent.mock.calls.map((c) => (c as unknown as [{ event: string }])[0].event);

describe("refreshAgreement → broker_countersigned", () => {
  beforeEach(() => {
    recordFunnelEvent.mockClear();
    updatedRows = [{ id: "a1" }];
  });

  it("signed → completed con la firma de la broker: un broker_countersigned, sin repetir agreement_signed", async () => {
    getEnvelopeStatus.mockResolvedValue({ status: "completed", completedDateTime: "2026-10-14T20:00:00Z" });
    getEnvelopeSigners.mockResolvedValue([seller, broker]);
    const st = await refreshAgreement({ id: "a1", envelope_id: "e1", property_id: "p1", status: "signed" });
    expect(st).toBe("completed");
    expect(events()).toEqual(["broker_countersigned"]);
  });

  it("sent → completed de una vez: firma del vendedor y contrafirma", async () => {
    getEnvelopeStatus.mockResolvedValue({ status: "completed" });
    getEnvelopeSigners.mockResolvedValue([seller, broker]);
    await refreshAgreement({ id: "a1", envelope_id: "e1", property_id: "p1", status: "sent" });
    expect(events()).toEqual(["listing_step_complete", "agreement_signed", "broker_countersigned"]);
  });

  it("completed sin la broker (sobre antiguo) o con la lectura de firmantes fallida: sin evento, el estado igual avanza", async () => {
    getEnvelopeStatus.mockResolvedValue({ status: "completed" });
    getEnvelopeSigners.mockResolvedValueOnce([seller]);
    expect(await refreshAgreement({ id: "a1", envelope_id: "e1", property_id: "p1", status: "signed" })).toBe("completed");
    getEnvelopeSigners.mockRejectedValueOnce(new Error("down"));
    expect(await refreshAgreement({ id: "a1", envelope_id: "e1", property_id: "p1", status: "signed" })).toBe("completed");
    expect(events()).toEqual([]);
  });

  it("otra actualización ganó la carrera: no se registra dos veces", async () => {
    updatedRows = [];
    getEnvelopeStatus.mockResolvedValue({ status: "completed" });
    getEnvelopeSigners.mockResolvedValue([seller, broker]);
    await refreshAgreement({ id: "a1", envelope_id: "e1", property_id: "p1", status: "signed" });
    expect(events()).toEqual([]);
  });
});
