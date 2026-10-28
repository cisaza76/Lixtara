// Plazo de firma con dos vendedores (#220): recordatorios a los días 2 y 5, vencimiento al 7.
import { describe, expect, it } from "vitest";
import { canResendInvitation, deadlineAction, isSigningExpired, LIXTARA_REMINDER_DAYS } from "@/lib/signing-deadline";

const DAY = 86_400_000;
const start = new Date("2026-11-02T15:00:00Z");
const row = (over: Record<string, unknown> = {}) => ({
  sellers_required: 2,
  additional_signer_signed_at: null,
  signing_deadline_at: new Date(start.getTime() + 7 * DAY).toISOString(),
  reminders_sent: 0,
  ...over,
});
const at = (days: number) => new Date(start.getTime() + days * DAY);

describe("deadlineAction", () => {
  it("los recordatorios de Lixtara son a los días 2 y 5", () => {
    expect(LIXTARA_REMINDER_DAYS).toEqual([2, 5]);
  });

  it("antes del día 2: nada", () => {
    expect(deadlineAction(row(), at(1.9))).toEqual({ kind: "none" });
  });

  it("día 2: primer recordatorio, una sola vez", () => {
    expect(deadlineAction(row(), at(2))).toEqual({ kind: "remind", reminder: 1 });
    expect(deadlineAction(row({ reminders_sent: 1 }), at(3))).toEqual({ kind: "none" });
  });

  it("día 5: segundo recordatorio; si el primero no salió, solo el segundo", () => {
    expect(deadlineAction(row({ reminders_sent: 1 }), at(5))).toEqual({ kind: "remind", reminder: 2 });
    expect(deadlineAction(row({ reminders_sent: 0 }), at(5.5))).toEqual({ kind: "remind", reminder: 2 });
    expect(deadlineAction(row({ reminders_sent: 2 }), at(6.9))).toEqual({ kind: "none" });
  });

  it("día 7: vence (aunque falten recordatorios)", () => {
    expect(deadlineAction(row({ reminders_sent: 0 }), at(7))).toEqual({ kind: "expire" });
    expect(isSigningExpired(row(), at(7))).toBe(true);
    expect(isSigningExpired(row(), at(6.99))).toBe(false);
  });

  it("un vendedor, el segundo ya firmó o sin plazo: nunca", () => {
    expect(deadlineAction(row({ sellers_required: 1 }), at(8))).toEqual({ kind: "none" });
    expect(deadlineAction(row({ additional_signer_signed_at: at(1).toISOString() }), at(8))).toEqual({ kind: "none" });
    expect(deadlineAction(row({ signing_deadline_at: null }), at(8))).toEqual({ kind: "none" });
    expect(isSigningExpired(row({ additional_signer_signed_at: at(1).toISOString() }), at(8))).toBe(false);
  });
});

describe("canResendInvitation", () => {
  it("solo mientras el sobre espera al segundo y el plazo no venció", () => {
    expect(canResendInvitation("sent", row(), at(3))).toBe(true);
    expect(canResendInvitation("delivered", row(), at(3))).toBe(true);
    expect(canResendInvitation("sent", row(), at(7))).toBe(false);
    expect(canResendInvitation("signed", row(), at(3))).toBe(false);
    expect(canResendInvitation("expired", row(), at(3))).toBe(false);
    expect(canResendInvitation("sent", row({ additional_signer_signed_at: at(1).toISOString() }), at(3))).toBe(false);
    expect(canResendInvitation("sent", row({ sellers_required: 1, signing_deadline_at: null }), at(3))).toBe(false);
  });
});
