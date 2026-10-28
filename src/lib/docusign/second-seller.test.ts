// #220: el sobre con un segundo vendedor ("Seller 2", plantilla v4) — roles, recordatorios y
// plazo, y cuándo cuenta como firmado. Y el plano de la plantilla para ese rol.
import { describe, it, expect } from "vitest";
import {
  buildTemplateRoles,
  envelopeNotification,
  InvalidAdditionalSignerError,
  secondSellerHasSigned,
  sellerHasSigned,
  type CreateEnvelopeInput,
} from "@/lib/docusign";
import { resolveAgreementStatus } from "@/lib/agreement-refresh";
import { ERS21TN_INITIALS, ERS21TN_SELLER2_FIELDS, ERS21TN_SELLER2_INITIALS, ERS21TN_SELLER2_SIGNATURES, ERS21TN_SELLER_SIGNATURES } from "@/lib/docusign/ers21tn-layout";
import { planSecondSellerFixes } from "@/lib/docusign/template-fix-plan";

const input = (extra: Partial<CreateEnvelopeInput> = {}): CreateEnvelopeInput => ({
  templateId: "t",
  signerRole: "Seller",
  signerEmail: "ana@example.com",
  signerName: "Ana",
  clientUserId: "prop-1",
  brokerSigner: { roleName: "Broker", name: "Broker", email: "broker@example.com" },
  ...extra,
});
const coOwner = { roleName: "Seller 2", name: "Luis", email: "luis@example.com", textTabs: { seller2_email: "luis@example.com" }, lockedTextTabs: ["seller2_email"] };

describe("roles del sobre", () => {
  it("un vendedor: Seller (1) + Broker (2), como hasta ahora", () => {
    expect(buildTemplateRoles(input(), {}).map((r) => [r.roleName, r.routingOrder])).toEqual([["Seller", "1"], ["Broker", "2"]]);
  });
  it("dos vendedores: Seller 2 firma por email (sin clientUserId), en paralelo (1), antes que la broker (2)", () => {
    const roles = buildTemplateRoles(input({ additionalSigners: [coOwner] }), {});
    expect(roles.map((r) => [r.roleName, r.routingOrder])).toEqual([["Seller", "1"], ["Seller 2", "1"], ["Broker", "2"]]);
    const second = roles[1] as Record<string, unknown>;
    expect(second.clientUserId).toBeUndefined();
    expect(second.tabs).toEqual({ textTabs: [{ tabLabel: "seller2_email", value: "luis@example.com", locked: "true" }] });
  });
  it("el correo del segundo vendedor no puede ser el del vendedor ni el de la broker", () => {
    expect(() => buildTemplateRoles(input({ additionalSigners: [{ ...coOwner, email: " ANA@example.com" }] }), {})).toThrow(InvalidAdditionalSignerError);
    expect(() => buildTemplateRoles(input({ additionalSigners: [{ ...coOwner, email: "broker@example.com" }] }), {})).toThrow(InvalidAdditionalSignerError);
    expect(() => buildTemplateRoles(input({ additionalSigners: [{ ...coOwner, email: "luis" }] }), {})).toThrow(InvalidAdditionalSignerError);
  });
  it("recordatorios a los 2 y 5 días y vencimiento a los 7, solo con dos vendedores", () => {
    expect(envelopeNotification(input())).toBeUndefined();
    expect(envelopeNotification(input({ additionalSigners: [coOwner] }))).toEqual({
      useAccountDefaults: "false",
      reminders: { reminderEnabled: "true", reminderDelay: "2", reminderFrequency: "3" },
      expirations: { expireEnabled: "true", expireAfter: "7", expireWarn: "1" },
    });
  });
});

describe("firmado = firmaron todos los vendedores (sin pago antes)", () => {
  const seller = { roleName: "Seller", clientUserId: "prop-1", status: "completed" };
  const broker = { roleName: "Broker", email: "broker@example.com", status: "sent" };
  it("un vendedor: su firma basta (como hasta ahora)", () => {
    expect(sellerHasSigned([seller, broker], "prop-1")).toBe(true);
  });
  it("dos vendedores: falta el segundo → no firmado, y el acuerdo sigue 'sent'", () => {
    const signers = [seller, { roleName: "Seller 2", email: "luis@example.com", status: "sent" }, broker];
    expect(sellerHasSigned(signers, "prop-1")).toBe(false);
    expect(secondSellerHasSigned(signers)).toBe(false);
    expect(resolveAgreementStatus("sent", sellerHasSigned(signers, "prop-1"))).toBe("sent");
  });
  it("firmó solo el segundo → no firmado", () => {
    const signers = [{ ...seller, status: "sent" }, { roleName: "Seller 2", status: "completed" }, broker];
    expect(sellerHasSigned(signers, "prop-1")).toBe(false);
    expect(secondSellerHasSigned(signers)).toBe(true);
  });
  it("firmaron los dos → 'signed' (se habilita el pago)", () => {
    const signers = [seller, { roleName: "Seller 2", status: "completed" }, broker];
    expect(sellerHasSigned(signers, "prop-1")).toBe(true);
    expect(resolveAgreementStatus("sent", sellerHasSigned(signers, "prop-1"))).toBe("signed");
  });
});

describe("plantilla v4: el rol Seller 2", () => {
  it("iniciales en el SEGUNDO espacio 'Seller (____)' de las 6 páginas, a la misma altura que el primero", () => {
    expect(ERS21TN_SELLER2_INITIALS.map((i) => i.page)).toEqual([1, 2, 3, 4, 5, 6]);
    const first = ERS21TN_INITIALS.find((i) => i.role === "Seller")!;
    for (const i of ERS21TN_SELLER2_INITIALS) {
      expect(i.x).toBeCloseTo(112.1, 1);
      expect(i.x - first.x).toBeGreaterThan(24); // a la derecha del primer espacio (24 pt)
      expect([i.y, i.scale]).toEqual([first.y, first.scale]);
    }
  });
  it("firma y fecha en L173, L203 y L250; email en L253", () => {
    expect(ERS21TN_SELLER2_SIGNATURES.map((s) => [s.kind, s.line, s.page])).toEqual([
      ["signHereTabs", 173, 4], ["dateSignedTabs", 173, 4],
      ["signHereTabs", 203, 4], ["dateSignedTabs", 203, 4],
      ["signHereTabs", 250, 6], ["dateSignedTabs", 250, 6],
    ]);
    // Misma columna que la del vendedor en L171/L201.
    const sellerSig = ERS21TN_SELLER_SIGNATURES.find((s) => s.line === 171 && s.kind === "signHereTabs")!;
    expect(ERS21TN_SELLER2_SIGNATURES[0].x).toBe(sellerSig.x);
    expect(ERS21TN_SELLER2_FIELDS.map((f) => [f.label, f.line, f.page, f.locked])).toEqual([["seller2_email", 253, 6, true]]);
  });
  it("en una plantilla sin el rol (v3), el plan crea sus 13 campos", () => {
    const steps = planSecondSellerFixes({});
    expect(steps).toHaveLength(13);
    expect(steps.every((s) => s.action === "create")).toBe(true);
  });
});
