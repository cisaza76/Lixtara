// Admin del titular y los firmantes (#220): bloqueo de la aprobación, Sunbiz, firmantes y las
// marcas que se borran cuando el vendedor cambia el titular.
import { describe, expect, it } from "vitest";
import {
  SIGNERS_ADMIN_COPY,
  agreementSignerLines,
  canClearManualReview,
  ownershipApprovalGate,
  ownershipGateMessage,
  sellerSignatureMissing,
  staffMarksToReset,
  sunbizSearchUrl,
  type StaffOwnership,
} from "@/lib/listing-signers-admin";

const base: StaffOwnership = {
  owner_kind: "individuals",
  other_title_holders: false,
  married_homestead: false,
  entity_name: null,
  entity_signer_title: null,
  entity_authority_confirmed_at: null,
  manual_review_reason: null,
  sunbiz_status: "unchecked",
  sunbiz_checked_at: null,
  authority_document_received_at: null,
  manual_review_cleared_at: null,
};
const entity = (over: Partial<StaffOwnership> = {}): StaffOwnership => ({
  ...base,
  owner_kind: "fl_entity",
  entity_name: "Sol Holdings LLC",
  entity_signer_title: "Manager",
  entity_authority_confirmed_at: "2026-11-01T00:00:00Z",
  ...over,
});

describe("ownershipApprovalGate", () => {
  it("personas físicas, o un listing de antes de #220 (sin fila): se aprueba como hasta ahora", () => {
    expect(ownershipApprovalGate(base)).toEqual({ ok: true });
    expect(ownershipApprovalGate(null)).toEqual({ ok: true });
  });

  it("entidad sin revisar en Sunbiz: no se aprueba", () => {
    expect(ownershipApprovalGate(entity())).toEqual({ ok: false, reason: "sunbiz_unchecked" });
  });

  it("entidad: figura → sí; no figura → solo con la resolución o el poder recibidos", () => {
    expect(ownershipApprovalGate(entity({ sunbiz_status: "listed" }))).toEqual({ ok: true });
    expect(ownershipApprovalGate(entity({ sunbiz_status: "not_listed" }))).toEqual({ ok: false, reason: "entity_authority_pending" });
    expect(
      ownershipApprovalGate(entity({ sunbiz_status: "not_listed", authority_document_received_at: "2026-11-02T00:00:00Z" })),
    ).toEqual({ ok: true });
  });

  it("revisión manual: solo destrabada", () => {
    const manual = { ...base, owner_kind: "manual_review", manual_review_reason: "trust" };
    expect(ownershipApprovalGate(manual)).toEqual({ ok: false, reason: "manual_review_pending" });
    expect(ownershipApprovalGate({ ...manual, manual_review_cleared_at: "2026-11-02T00:00:00Z" })).toEqual({ ok: true });
  });

  it("cada motivo tiene su mensaje EN/ES", () => {
    for (const r of ["sunbiz_unchecked", "entity_authority_pending", "manual_review_pending"]) {
      expect(ownershipGateMessage(r, "en")).toBeTruthy();
      expect(ownershipGateMessage(r, "es")).toBeTruthy();
    }
    expect(ownershipGateMessage("not_countersigned", "en")).toBeNull();
  });
});

describe("canClearManualReview", () => {
  it("3 o más dueños no se destraba desde el sitio (el sobre lleva hasta 2 vendedores)", () => {
    expect(canClearManualReview("three_or_more_owners")).toBe(false);
    for (const r of ["non_fl_entity", "trust", "estate", "poa"]) expect(canClearManualReview(r)).toBe(true);
    expect(canClearManualReview(null)).toBe(false);
  });
});

describe("sunbizSearchUrl", () => {
  it("búsqueda por nombre de entidad, con el nombre ya cargado y codificado", () => {
    const url = new URL(sunbizSearchUrl("  Sol & Mar Holdings, LLC "));
    expect(url.origin).toBe("https://search.sunbiz.org");
    expect(url.searchParams.get("inquiryType")).toBe("EntityName");
    expect(url.searchParams.get("searchTerm")).toBe("Sol & Mar Holdings, LLC");
  });
});

describe("agreementSignerLines", () => {
  const agreement = { status: "sent", sellers_required: 2, additional_signer_signed_at: null };
  const cosigner = { full_name: "Luis Pérez", relationship: "homestead_spouse" };

  it("en vivo: vendedor firmó, Seller 2 pendiente, broker pendiente", () => {
    const lines = agreementSignerLines({
      ownership: base,
      sellerName: "Ana Pérez",
      cosigner,
      agreement,
      propertyId: "p1",
      live: [
        { roleName: "Seller", clientUserId: "p1", name: "Ana Pérez", status: "completed" },
        { roleName: "Seller 2", name: "Luis Pérez", status: "sent" },
        { roleName: "Broker", name: "Broker", status: "created" },
      ],
    });
    expect(lines.map((l) => [l.role, l.relationship, l.status])).toEqual([
      ["seller", "owner", "signed"],
      ["second_seller", "homestead_spouse", "pending"],
      ["broker", "broker", "pending"],
    ]);
    expect(sellerSignatureMissing(lines)).toBe(true);
  });

  it("sin DocuSign (cola): el estado guardado; signed = firmaron todos los vendedores", () => {
    const lines = agreementSignerLines({
      ownership: base,
      sellerName: "Ana Pérez",
      cosigner,
      agreement: { status: "signed", sellers_required: 2, additional_signer_signed_at: "2026-11-03T00:00:00Z" },
      propertyId: "p1",
      live: null,
    });
    expect(lines.map((l) => l.status)).toEqual(["signed", "signed", "pending"]);
    expect(sellerSignatureMissing(lines)).toBe(false);
  });

  it("entidad: un firmante, que firma por la entidad; sin acuerdo: sin enviar", () => {
    const lines = agreementSignerLines({ ownership: entity(), sellerName: "Ana", cosigner: null, agreement: null, propertyId: "p1", live: null });
    expect(lines).toEqual([{ role: "seller", name: "Ana", relationship: "entity_signer", status: "not_sent" }]);
  });
});

describe("staffMarksToReset (el vendedor cambia el titular en el paso 3)", () => {
  const stored = { ...entity({ sunbiz_status: "not_listed", authority_document_received_at: "2026-11-02T00:00:00Z" }) };

  it("misma entidad (sin distinguir mayúsculas ni espacios): las marcas siguen", () => {
    expect(staffMarksToReset(stored, { owner_kind: "fl_entity", entity_name: " sol holdings llc ", manual_review_reason: null })).toBeNull();
  });

  it("otra entidad o dejó de ser entidad: Sunbiz y el documento vuelven a cero", () => {
    const reset = {
      sunbiz_status: "unchecked",
      sunbiz_checked_by: null,
      sunbiz_checked_at: null,
      authority_document_received_at: null,
      authority_document_received_by: null,
    };
    expect(staffMarksToReset(stored, { owner_kind: "fl_entity", entity_name: "Otra LLC", manual_review_reason: null })).toEqual(reset);
    expect(staffMarksToReset(stored, { owner_kind: "individuals", entity_name: null, manual_review_reason: null })).toEqual(reset);
  });

  it("revisión manual destrabada: se borra si cambia el motivo o deja de ser revisión manual", () => {
    const cleared = { ...base, owner_kind: "manual_review", manual_review_reason: "trust", manual_review_cleared_at: "2026-11-02T00:00:00Z" };
    expect(staffMarksToReset(cleared, { owner_kind: "manual_review", entity_name: null, manual_review_reason: "trust" })).toBeNull();
    expect(staffMarksToReset(cleared, { owner_kind: "manual_review", entity_name: null, manual_review_reason: "estate" })).toEqual({
      manual_review_cleared_at: null,
      manual_review_cleared_by: null,
    });
    expect(staffMarksToReset(cleared, { owner_kind: "individuals", entity_name: null, manual_review_reason: null })).toEqual({
      manual_review_cleared_at: null,
      manual_review_cleared_by: null,
    });
  });

  it("sin marcas o sin fila guardada: nada", () => {
    expect(staffMarksToReset(base, { owner_kind: "fl_entity", entity_name: "X LLC", manual_review_reason: null })).toBeNull();
    expect(staffMarksToReset(null, { owner_kind: "fl_entity", entity_name: "X LLC", manual_review_reason: null })).toBeNull();
  });
});

describe("SIGNERS_ADMIN_COPY", () => {
  it("EN y ES tienen las mismas claves", () => {
    const keys = (o: object, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
    expect(keys(SIGNERS_ADMIN_COPY.es)).toEqual(keys(SIGNERS_ADMIN_COPY.en));
  });
});
