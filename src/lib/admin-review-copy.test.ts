import { describe, expect, it } from "vitest";
import {
  ADMIN_REVIEW_COPY,
  agreementApprovalBlock,
  agreementStatusLabel,
  approvalBlockMessage,
  readableValue,
  sellersSignedCount,
  signersProgress,
} from "@/lib/admin-review-copy";
import type { SignerLine } from "@/lib/listing-signers-admin";

const line = (role: SignerLine["role"], status: SignerLine["status"]): SignerLine => ({
  role,
  name: "",
  relationship: role === "broker" ? "broker" : "owner",
  status,
});

function keysOf(o: unknown, prefix = ""): string[] {
  if (typeof o !== "object" || o === null) return [prefix];
  return Object.entries(o).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k));
}

describe("revisión del listing en EN/ES", () => {
  it("las dos lenguas tienen las mismas claves y ningún texto vacío", () => {
    expect(keysOf(ADMIN_REVIEW_COPY.es).sort()).toEqual(keysOf(ADMIN_REVIEW_COPY.en).sort());
    expect(ADMIN_REVIEW_COPY.es.approve).toBe("Aprobar → Activo");
    expect(ADMIN_REVIEW_COPY.es.mlsPublication).toBe("Publicación en el MLS");
    expect(ADMIN_REVIEW_COPY.es.rejectWithdraw).toBe("Rechazar (retirar)");
    expect(ADMIN_REVIEW_COPY.es.requestChanges).toBe("Pedir cambios →");
  });

  it("la página no deja textos sueltos en inglés", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/[lang]/admin/listings/[id]/review/page.tsx", "utf8");
    for (const s of ["MLS publication", "Approve → Active", "Reject (withdraw)", "Request changes →", "Status: <strong>", 'field("Type"', 'field("Occupancy"', "Nothing was changed"]) {
      expect(page, s).not.toContain(s);
    }
  });

  it("valores legibles", () => {
    expect(readableValue("property_type", "condo", "es")).toBe("Condominio");
    expect(readableValue("property_type", "condo", "en")).toBe("Condo");
    expect(readableValue("occupancy_status", "owner_occupied", "es")).toBe("Ocupada por el dueño");
    expect(readableValue("occupancy_status", "owner_occupied", "en")).toBe("Owner-occupied");
    expect(readableValue("tenant_cooperation", "advance_notice", "es")).toBe("Prefiere aviso previo (24–48 h)");
    expect(readableValue("mls_status", "pending_approval", "es")).toBe("Pendiente de aprobación");
    expect(readableValue("property_type", "new_kind", "es")).toBe("new kind");
    expect(readableValue("property_type", null, "es")).toBeNull();
  });

  it("'signed' es firmado por los vendedores y falta la contrafirma", () => {
    expect(agreementStatusLabel("signed", "es")).toBe("Firmado por los vendedores · falta la contrafirma de la broker");
    expect(agreementStatusLabel("signed", "en")).toBe("Signed by the sellers · waiting for the broker's countersignature");
    expect(agreementStatusLabel("completed", "es")).toContain("contrafirmado");
    expect(agreementStatusLabel("voided", "es")).toBe("Anulado");
  });
});

describe("agreementApprovalBlock: aprobar solo con el acuerdo completo", () => {
  const two = (a: SignerLine["status"], b: SignerLine["status"]) => [line("seller", a), line("second_seller", b), line("broker", "pending")];
  it("completed aprueba; todo lo demás bloquea con su motivo", () => {
    expect(agreementApprovalBlock("completed", two("signed", "signed"))).toBeNull();
    expect(agreementApprovalBlock(null, [])).toBe("no_agreement");
    expect(agreementApprovalBlock("voided", [])).toBe("agreement_void");
    expect(agreementApprovalBlock("expired", [])).toBe("agreement_void");
    expect(agreementApprovalBlock("declined", [])).toBe("agreement_void");
    expect(agreementApprovalBlock("signed", two("signed", "signed"))).toBe("countersign_missing");
    expect(agreementApprovalBlock("sent", two("signed", "pending"))).toBe("seller_signature_missing");
    expect(agreementApprovalBlock("sent", two("signed", "signed"))).toBe("countersign_missing");
  });
  it("mensaje del anulado con el estado en palabras", () => {
    expect(approvalBlockMessage("agreement_void", "voided", "es")).toBe(
      "El acuerdo de listado está anulado: el vendedor tiene que enviar uno nuevo antes de aprobar.",
    );
  });
});

describe("sellersSignedCount / signersProgress", () => {
  it("cuenta solo a los vendedores", () => {
    expect(sellersSignedCount([line("seller", "signed"), line("second_seller", "pending"), line("broker", "pending")])).toEqual({ signed: 1, total: 2 });
    expect(sellersSignedCount([line("seller", "signed"), line("broker", "pending")])).toEqual({ signed: 1, total: 1 });
    expect(sellersSignedCount([line("broker", "pending")])).toBeNull();
  });
  it("'Vendedores 2/2 · Broker pendiente': la broker aparte, en EN/ES", () => {
    const two = [line("seller", "signed"), line("second_seller", "signed")];
    expect(signersProgress([...two, line("broker", "pending")], "es")).toBe("Vendedores 2/2 · Broker pendiente");
    expect(signersProgress([...two, line("broker", "not_sent")], "es")).toBe("Vendedores 2/2 · Broker pendiente");
    expect(signersProgress([...two, line("broker", "signed")], "es")).toBe("Vendedores 2/2 · Broker firmó");
    expect(signersProgress([line("seller", "signed"), line("second_seller", "pending"), line("broker", "pending")], "en")).toBe("Sellers 1/2 · Broker pending");
    expect(signersProgress([line("seller", "pending")], "es")).toBe("Vendedores 0/1");
    expect(signersProgress([], "es")).toBeNull();
  });
});

describe("admin en /es sin restos en inglés", () => {
  it("'listado', no 'listing'", () => {
    const strings = keysOf(ADMIN_REVIEW_COPY.es).map((k) => k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], ADMIN_REVIEW_COPY.es));
    for (const v of strings) expect(String(v), String(v)).not.toMatch(/\blistings?\b/i);
    expect(ADMIN_REVIEW_COPY.es.published.approved).toBe("Listado aprobado (activo)");
    expect(ADMIN_REVIEW_COPY.es.publishHelp).toMatch(/^Hazlo cuando el listado ya esté en Matrix/);
  });
});
