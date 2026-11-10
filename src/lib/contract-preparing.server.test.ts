// Aviso interno del guard de producción: a Camilo y a la broker, una vez por listing,
// destinatario y día en Miami; nunca lanza.
import { describe, it, expect, vi, beforeEach } from "vitest";

const sent: Array<Record<string, unknown>> = [];
let fail = false;
vi.mock("@/lib/email", () => ({
  sendContractPreparingInternal: async (input: Record<string, unknown>) => {
    if (fail) throw new Error("resend down");
    sent.push(input);
    return { ok: true };
  },
}));

import { BROKER_SIGNER_EMAIL } from "@/config/brokerage";
import { contractPreparingRecipients, miamiDay, notifyContractPreparing } from "./contract-preparing.server";

const input = {
  propertyId: "p1",
  propertyAddress: "1 Main St, Miami, FL 33101",
  tier: "pro",
  listPrice: 400000,
  seller: { name: "Ana", email: "s@example.com", phone: "+1 305 555 0100", lang: "es" as const },
  cosigner: null,
  reviewUrl: "https://lixtara.com/es/admin/listings/p1/review",
};

describe("notifyContractPreparing", () => {
  beforeEach(() => {
    sent.length = 0;
    fail = false;
  });

  it("destinatarios: BROKER_NOTIFICATION_EMAIL y la broker, sin duplicados", () => {
    expect(contractPreparingRecipients({ BROKER_NOTIFICATION_EMAIL: "ops@lixtara.com" } as never)).toEqual(["ops@lixtara.com", BROKER_SIGNER_EMAIL]);
    expect(contractPreparingRecipients({ BROKER_NOTIFICATION_EMAIL: BROKER_SIGNER_EMAIL!.toUpperCase() } as never)).toHaveLength(1);
  });

  it("un correo por destinatario, con clave por listing, destinatario y día de Miami", async () => {
    vi.stubEnv("BROKER_NOTIFICATION_EMAIL", "ops@lixtara.com");
    // 2026-11-11 03:00 UTC = 2026-11-10 22:00 en Miami.
    await notifyContractPreparing(input, new Date("2026-11-11T03:00:00Z"));
    vi.unstubAllEnvs();
    expect(sent.map((s) => s.to)).toEqual(["ops@lixtara.com", BROKER_SIGNER_EMAIL]);
    expect(sent[0]).toMatchObject({ ...input, idempotencyKey: "contract-preparing:p1:ops@lixtara.com:2026-11-10" });
    expect(miamiDay(new Date("2026-11-11T03:00:00Z"))).toBe("2026-11-10");
  });

  it("si Resend falla, no lanza", async () => {
    fail = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyContractPreparing(input)).resolves.toBeUndefined();
    err.mockRestore();
  });
});
