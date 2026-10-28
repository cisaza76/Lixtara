// La sección "Titular y firmantes" de la revisión del listing (#220) se renderiza con el segundo
// firmante, su relación y el estado de cada firma. Falla si la sección deja de salir.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { OwnerSignersSection } from "@/components/admin/owner-signers-section";
import { agreementSignerLines, ownershipApprovalGate, type StaffOwnership } from "@/lib/listing-signers-admin";

const noop = async () => {};
const actions = { markSunbizListed: noop, markSunbizNotListed: noop, markAuthorityDocument: noop, clearManualReview: noop };
const ownership = {
  owner_kind: "individuals",
  other_title_holders: false,
  married_homestead: true,
  entity_name: null,
  entity_signer_title: null,
  entity_authority_confirmed_at: null,
  manual_review_reason: null,
  sunbiz_status: "unchecked",
  sunbiz_checked_at: null,
  authority_document_received_at: null,
  manual_review_cleared_at: null,
} as unknown as StaffOwnership;

function render(lang: string, live: Array<Record<string, string>> | null, status = "signed") {
  const lines = agreementSignerLines({
    ownership,
    sellerName: "QA SMTPTest",
    cosigner: { full_name: "QA Spouse", relationship: "homestead_spouse" },
    agreement: { status, sellers_required: 2, additional_signer_signed_at: "2026-10-28T15:00:00Z" },
    live,
    propertyId: "p1",
  });
  return renderToStaticMarkup(
    createElement(OwnerSignersSection, {
      lang,
      ownership,
      signerLines: lines,
      hasAgreement: true,
      ownerGate: ownershipApprovalGate(ownership),
      actions,
    }),
  );
}

describe("OwnerSignersSection", () => {
  it("dos vendedores que firmaron (en vivo): titular, cada firmante con su relación y su firma, y 2/2", () => {
    const html = render("es", [
      { roleName: "Seller", clientUserId: "p1", name: "QA SMTPTest", status: "completed" },
      { roleName: "Seller 2", name: "QA Spouse", status: "completed" },
      { roleName: "Broker", name: "Broker", status: "sent" },
    ]);
    expect(html).toContain("data-owner-signers");
    expect(html).toContain("Titular y firmantes");
    expect(html).toContain("Persona(s) física(s)");
    expect(html).toMatch(/data-signer="seller" data-signer-status="signed"/);
    expect(html).toMatch(/data-signer="second_seller" data-signer-status="signed"/);
    expect(html).toContain("QA Spouse");
    expect(html).toContain("Cónyuge (homestead)");
    expect(html).toMatch(/data-signer="broker" data-signer-status="pending"/);
    expect(html).toMatch(/data-signers-count[^>]*>2\/2</);
  });

  it("sin DocuSign (estado guardado) el segundo firmante sale igual", () => {
    const html = render("en", null, "sent");
    expect(html).toContain("data-owner-signers");
    expect(html).toContain("QA Spouse");
    expect(html).toContain("Spouse (homestead)");
  });

  it("la revisión del listing usa la sección (no la quita ni la condiciona)", () => {
    const page = readFileSync("src/app/[lang]/admin/listings/[id]/review/page.tsx", "utf8");
    expect(page).toContain("<OwnerSignersSection");
    expect(page).toContain("const { ownership, signer: cosigner } = await loadOwnershipForStaff(id);");
  });
});
