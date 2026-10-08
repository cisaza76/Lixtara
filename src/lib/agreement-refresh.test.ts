import { describe, it, expect } from "vitest";
import { isFinalAgreementStatus, resolveAgreementStatus } from "@/lib/agreement-refresh";

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
