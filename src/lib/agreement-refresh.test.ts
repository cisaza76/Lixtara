import { describe, it, expect } from "vitest";
import { isFinalAgreementStatus, publishGateDecision, resolveAgreementStatus } from "@/lib/agreement-refresh";

describe("resolveAgreementStatus", () => {
  it("counts the seller's signature while the envelope waits for others", () => {
    expect(resolveAgreementStatus("sent", true)).toBe("signed");
    expect(resolveAgreementStatus("delivered", true)).toBe("signed");
  });
  it("keeps the envelope status while the seller hasn't signed", () => {
    expect(resolveAgreementStatus("sent", false)).toBe("sent");
    expect(resolveAgreementStatus("delivered", false)).toBe("delivered");
  });
  it("final envelope statuses win", () => {
    expect(resolveAgreementStatus("completed", false)).toBe("completed");
    expect(resolveAgreementStatus("declined", true)).toBe("declined");
    expect(resolveAgreementStatus("voided", true)).toBe("voided");
  });
});

describe("isFinalAgreementStatus", () => {
  it("treats completed/declined/voided/expired as final; signed can still complete", () => {
    for (const s of ["completed", "declined", "voided", "expired"]) {
      expect(isFinalAgreementStatus(s)).toBe(true);
    }
    for (const s of ["pending", "sent", "delivered", "signed"]) {
      expect(isFinalAgreementStatus(s)).toBe(false);
    }
  });
});

describe("publishGateDecision (vendedor paga al firmar; publica solo con contrafirma)", () => {
  const broker = { roleName: "Broker", email: "anamaria@lixtara.com", status: "completed" };
  const seller = { roleName: "Seller", clientUserId: "p1", email: "s@example.com", status: "completed" };
  it("signed (solo el vendedor) no publica", () => {
    expect(publishGateDecision("signed", null, "anamaria@lixtara.com")).toEqual({ ok: false, reason: "not_countersigned" });
  });
  it("completed con la firma de la broker publica", () => {
    expect(publishGateDecision("completed", [seller, broker], "anamaria@lixtara.com")).toEqual({ ok: true });
  });
  it("completed sin rol de broker (sobre antiguo de una sola firma) no publica", () => {
    expect(publishGateDecision("completed", [seller], "anamaria@lixtara.com").ok).toBe(false);
  });
  it("broker con otro email, aún sin firmar o sin email configurado no publica", () => {
    expect(publishGateDecision("completed", [seller, { ...broker, email: "otra@lixtara.com" }], "anamaria@lixtara.com").ok).toBe(false);
    expect(publishGateDecision("completed", [seller, { ...broker, status: "sent" }], "anamaria@lixtara.com").ok).toBe(false);
    expect(publishGateDecision("completed", [seller, broker], null).ok).toBe(false);
  });
  it("el vendedor embebido nunca cuenta como broker", () => {
    expect(publishGateDecision("completed", [{ ...broker, clientUserId: "p1" }], "anamaria@lixtara.com").ok).toBe(false);
  });
  it("DocuSign no responde → no publica (fail-closed)", () => {
    expect(publishGateDecision("completed", null, "anamaria@lixtara.com")).toEqual({ ok: false, reason: "docusign_unavailable" });
  });
});
