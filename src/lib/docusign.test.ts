import { describe, it, expect } from "vitest";
import { mapEnvelopeStatus } from "@/lib/docusign";

describe("mapEnvelopeStatus", () => {
  it("maps each DocuSign envelope status to our internal status", () => {
    expect(mapEnvelopeStatus("created")).toBe("pending");
    expect(mapEnvelopeStatus("sent")).toBe("sent");
    expect(mapEnvelopeStatus("delivered")).toBe("delivered");
    expect(mapEnvelopeStatus("signed")).toBe("signed");
    expect(mapEnvelopeStatus("completed")).toBe("completed");
    expect(mapEnvelopeStatus("declined")).toBe("declined");
    expect(mapEnvelopeStatus("voided")).toBe("voided");
    expect(mapEnvelopeStatus("expired")).toBe("expired");
  });

  it("is case-insensitive", () => {
    expect(mapEnvelopeStatus("Completed")).toBe("completed");
    expect(mapEnvelopeStatus("SENT")).toBe("sent");
  });

  it("falls back to 'pending' for any unknown status", () => {
    expect(mapEnvelopeStatus("authoritativecopy")).toBe("pending");
    expect(mapEnvelopeStatus("")).toBe("pending");
  });
});

describe("sellerHasSigned", () => {
  it("is true once the seller (embedded signer) completed, even if the broker hasn't", async () => {
    const { sellerHasSigned } = await import("@/lib/docusign");
    expect(
      sellerHasSigned(
        [
          { roleName: "Seller", clientUserId: "p1", status: "completed" },
          { roleName: "Broker", status: "sent" },
        ],
        "p1",
      ),
    ).toBe(true);
  });
  it("is false while the seller hasn't signed", async () => {
    const { sellerHasSigned } = await import("@/lib/docusign");
    expect(
      sellerHasSigned([{ roleName: "Seller", clientUserId: "p1", status: "delivered" }], "p1"),
    ).toBe(false);
    expect(sellerHasSigned([], "p1")).toBe(false);
  });
  it("falls back to the Seller role when clientUserId is missing", async () => {
    const { sellerHasSigned } = await import("@/lib/docusign");
    expect(sellerHasSigned([{ roleName: "Seller", status: "completed" }], "p1")).toBe(true);
  });
});
