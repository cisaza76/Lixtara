import { describe, it, expect, vi } from "vitest";
import {
  LIXTARA_BROKER_ROLE,
  MissingBrokerSignerError,
  buildTemplateRoles,
  createEnvelopeFromTemplate,
  mapEnvelopeStatus,
  primarySellerHasSigned,
  sellerHasSigned,
} from "@/lib/docusign";

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

describe("roles del sobre: vendedor + broker de Lixtara (#137 f)", () => {
  const base = {
    templateId: "t",
    signerRole: "Seller",
    signerEmail: "seller@example.com",
    signerName: "Seller Name",
    clientUserId: "p1",
  };
  const broker = { roleName: LIXTARA_BROKER_ROLE.listingAgreement, name: "Anamaria Velasquez", email: "anamaria@lixtara.com" };

  it("vendedor firma primero (1), la broker contrafirma después (2)", () => {
    const roles = buildTemplateRoles({ ...base, brokerSigner: broker }, {});
    expect(roles).toEqual([
      { email: "seller@example.com", name: "Seller Name", roleName: "Seller", clientUserId: "p1", routingOrder: "1", tabs: undefined },
      { email: "anamaria@lixtara.com", name: "Anamaria Velasquez", roleName: "Broker", routingOrder: "2" },
    ]);
  });

  it("sin broker, sin email válido o con el email del vendedor → falla ANTES de DocuSign", () => {
    for (const b of [null, { ...broker, email: "" }, { ...broker, email: "nope" }, { ...broker, roleName: " " },
                     { ...broker, email: "SELLER@example.com" }]) {
      expect(() => buildTemplateRoles({ ...base, brokerSigner: b }, {})).toThrow(MissingBrokerSignerError);
    }
  });

  it("createEnvelopeFromTemplate no llama a la red sin broker", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(createEnvelopeFromTemplate({ ...base, brokerSigner: null })).rejects.toThrow("broker_signer_not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
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

describe("primarySellerHasSigned (#220)", () => {
  const seller = { roleName: "Seller", clientUserId: "p1", status: "completed" };
  const second = { roleName: "Seller 2", email: "luis@example.com", status: "sent" };
  it("cuenta solo la firma del vendedor de la cuenta, aunque falte el otro", () => {
    expect(primarySellerHasSigned([seller, second], "p1")).toBe(true);
    expect(sellerHasSigned([seller, second], "p1")).toBe(false);
  });
  it("el segundo firmó y el vendedor no: false", () => {
    expect(primarySellerHasSigned([{ ...seller, status: "sent" }, { ...second, status: "completed" }], "p1")).toBe(false);
  });
});
