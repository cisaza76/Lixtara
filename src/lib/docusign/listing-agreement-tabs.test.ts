// Listing Agreement (ERS-21tn): lo que Lixtara escribe en cada línea (2026-10-21). Sin red.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PRICING_TIERS } from "@/lib/pricing-tiers";
import { t } from "@/lib/i18n";
import { ERS21TN_FIELDS, fitsOnLine } from "./ers21tn-layout";
import { attachmentHtml, listingAgreementTabs, splitOverLines, usDate, type AgreementInput } from "./listing-agreement-tabs";

const base: AgreementInput = {
  listing: {
    address_street: "200 S Biscayne Blvd, Unit 4",
    address_city: "Miami",
    address_state: "FL",
    address_zip: "33131",
    folio: "0102060101010",
    list_price: 650000,
    cash_only: true,
    occupancy_status: "vacant",
    lease_end_date: null,
    appliances: ["refrigerator", "dishwasher"],
    pricing_tier: "pro",
  },
  tier: PRICING_TIERS.pro,
  sellerName: "Test Seller",
  brokerName: "Lixtara LLC",
  buyerOffer: { type: "percent", pct: 2.5 },
  verifiedLegal: "SABAL PALM COURT PB 46-66\nLOT 4 BLK 1",
  applianceLabels: t("en").listingForm.step3.appliances as Record<string, string>,
  today: new Date("2026-10-21T15:00:00Z"),
};
const run = (over: Partial<AgreementInput> = {}, listing: Partial<AgreementInput["listing"]> = {}) =>
  listingAgreementTabs({ ...base, ...over, listing: { ...base.listing, ...listing } });

const LAYOUT_LABELS = new Set(
  ERS21TN_FIELDS.flatMap((f) => (f.kind === "radio" ? [f.groupName] : [f.label])),
);

describe("Listing Agreement: valores por línea", () => {
  it("cada etiqueta que se manda existe en la plantilla corregida", () => {
    const r = run();
    for (const k of [...Object.keys(r.text), ...Object.keys(r.checkbox), ...Object.keys(r.radio)]) {
      expect(LAYOUT_LABELS.has(k), k).toBe(true);
    }
  });

  it("sin «$» ni «%» repetidos: el formulario ya los imprime (L22, L110, L145–146)", () => {
    const r = run();
    expect(r.text).toMatchObject({ list_price: "650,000", commission_pct: "1", flat_fee: "495", buyer_comp_pct: "2.5", buyer_comp_amount: "" });
    expect(run({ buyerOffer: { type: "amount", amount: 12000 } }).text).toMatchObject({ buyer_comp_pct: "", buyer_comp_amount: "12,000" });
    expect(run({ buyerOffer: { type: "none" } }).text).toMatchObject({ buyer_comp_pct: "", buyer_comp_amount: "" });
    expect(run({ buyerOffer: { type: "none" } }).checkbox.buyer_commission_ack).toBe(false);
    for (const v of Object.values(r.text)) expect(v).not.toMatch(/^\$|%$/);
  });

  it("dirección: la calle en L13 y ciudad, estado y ZIP en L14, sin repetir", () => {
    expect(run().text).toMatchObject({ street_address: "200 S Biscayne Blvd, Unit 4", city_state_zip: "Miami, FL 33131" });
  });

  it("descripción legal verificada que cabe: L15–L16, sin anexo", () => {
    const r = run();
    expect(`${r.text.legal_description} ${r.text.legal_description_2}`.trim()).toBe("SABAL PALM COURT PB 46-66; LOT 4 BLK 1");
    expect(r.checkbox.legal_see_attachment).toBe(false);
    expect(r.attachment).toEqual([]);
  });

  it("descripción legal sin verificar: líneas vacías, «See Attachment» y anexo; nunca otro dato", () => {
    const r = run({ verifiedLegal: null });
    expect([r.text.legal_description, r.text.legal_description_2]).toEqual(["", ""]);
    expect(r.checkbox.legal_see_attachment).toBe(true);
    expect(r.attachment[0].heading).toMatch(/Legal Description/);
    expect(r.attachment[0].body.split("\n")).toEqual([
      "Folio (Parcel ID): 0102060101010",
      "Property address: 200 S Biscayne Blvd, Unit 4, Miami, FL 33131",
      "County: To be confirmed by Broker from the county property record",
      "",
      "To be provided by Broker from the official county property record for the Property described in line 13.",
    ]);
    expect(r.legalStatus).toBe("pending");
    expect(run({}, { folio: null }).attachment).toEqual([]); // la de base sí se verificó y cabe
    expect(run({ verifiedLegal: null }, { folio: null }).attachment[0].body).toMatch(/^Folio \(Parcel ID\): Not available\n/);
  });

  it("descripción legal verificada demasiado larga: «See Attachment» con el texto completo del condado", () => {
    const long =
      "MIAMI CONVENTION CENTER AMEND\nPB 119-36\nTR C LESS BEG SE COR OF TR C TH N 89 DEG W 250.31 FT\nN 00 DEG E 160 FT TO POB\nLOT SIZE 107158 SQ FT\nOR 17462-3723 1296 1\nCOC 25947-1040 25975-4782 0907 4";
    const r = run({ verifiedLegal: long });
    expect([r.text.legal_description, r.text.legal_description_2]).toEqual(["", ""]);
    expect(r.checkbox.legal_see_attachment).toBe(true);
    expect(r.attachment[0].body).toBe(`Folio (Parcel ID): 0102060101010\nProperty address: 200 S Biscayne Blvd, Unit 4, Miami, FL 33131\nCounty: Miami-Dade\n\n${long}`);
    expect(r.legalStatus).toBe("verified");
  });

  it("personal property: una línea; si no cabe, «See Attachment» y la lista en el anexo", () => {
    expect(run().text.personal_property).toBe("Refrigerator, Dishwasher");
    expect(run({}, { appliances: [] }).text.personal_property).toBe("None");
    const all = Object.keys(base.applianceLabels);
    const r = run({}, { appliances: all });
    if (fitsOnLine("personal_property", all.map((k) => base.applianceLabels[k]).join(", "))) return;
    expect(r.text.personal_property).toBe("");
    expect(r.checkbox.personal_property_see_attachment).toBe(true);
    expect(r.attachment.some((s) => s.heading.startsWith("Personal Property"))).toBe(true);
  });

  it("ocupación: una sola opción desde el paso 3; el vencimiento del alquiler solo con «is», MM/DD/YYYY", () => {
    const tenant = run({}, { occupancy_status: "tenant_occupied", lease_end_date: "2026-12-31" });
    expect(tenant.radio.occupancy).toEqual({ value: "is", locked: true, options: ["is", "is_not"] });
    expect(tenant.text.lease_end_date).toBe("12/31/2026");
    expect(tenant.lockedText).toContain("lease_end_date");

    const vacant = run({}, { occupancy_status: "vacant", lease_end_date: "2026-12-31" });
    expect(vacant.radio.occupancy).toEqual({ value: "is_not", locked: true, options: ["is", "is_not"] });
    expect(vacant.text.lease_end_date).toBe("");

    expect(run({}, { occupancy_status: "owner_occupied" }).radio.occupancy.value).toBe("is_not");
    const unset = run({}, { occupancy_status: null });
    expect(unset.radio.occupancy).toEqual({ value: null, locked: false, options: ["is", "is_not"] });

    // Con inquilino y «No la sé» en el paso 3: vacía y de solo lectura.
    const unknown = run({}, { occupancy_status: "tenant_occupied", lease_end_date: null });
    expect(unknown.text.lease_end_date).toBe("");
    expect(unknown.lockedText).toContain("lease_end_date");
  });

  it("financiamiento (L23) desde el paso 3, de solo lectura; «Other (specify)» solo con Other", () => {
    const a = run({}, { financing_terms: ["cash", "conventional"], financing_other: null });
    expect(a.checkbox).toMatchObject({ financing_cash: true, financing_conventional: true, financing_va: false, financing_fha: false, financing_other: false });
    expect(a.text.financing_other_specify).toBe("");
    const b = run({}, { financing_terms: ["other"], financing_other: "Lease-purchase" });
    expect(b.checkbox).toMatchObject({ financing_cash: false, financing_other: true });
    expect(b.text.financing_other_specify).toBe("Lease-purchase");
    expect(b.attachment).toEqual([]);
    // No cabe en L23 (~26 caracteres): «See Attachment» y el texto completo en el anexo.
    const long = run({}, { financing_terms: ["other"], financing_other: "Seller financing with 20% down, 5 years" });
    expect(long.text.financing_other_specify).toBe("See Attachment");
    expect(long.attachment).toEqual([{ heading: "Financing Terms, Other (line 23)", body: "Seller financing with 20% down, 5 years" }]);
    // Texto guardado sin Other: no se escribe (nunca «Cash» ni nada en Other).
    expect(run({}, { financing_terms: ["cash"], financing_other: "Cash" }).text.financing_other_specify).toBe("");
    // Listing anterior a la migración: desde cash_only.
    expect(run({}, { financing_terms: null, cash_only: true }).checkbox.financing_cash).toBe(true);
    expect(a.lockedCheckbox).toEqual(expect.arrayContaining(["financing_cash", "financing_conventional", "financing_va", "financing_fha", "financing_other"]));
    expect(b.lockedText).toContain("financing_other_specify");
  });

  it("lo que pone el sitio queda bloqueado para el vendedor", () => {
    const r = run();
    for (const k of ["seller_name", "broker_name", "start_date", "termination_date", "street_address", "city_state_zip", "list_price", "commission_pct", "flat_fee", "buyer_comp_pct", "buyer_comp_amount", "legal_description", "personal_property"]) {
      expect(r.lockedText, k).toContain(k);
    }
    expect(r.lockedCheckbox).toEqual(expect.arrayContaining(["lockbox_authorized", "buyer_commission_ack"]));
  });

  it("fechas del plazo: hoy y hoy + 24 meses", () => {
    expect(run().text).toMatchObject({ start_date: "October 21, 2026", termination_date: "October 21, 2028" });
  });

  it("utilidades: fecha MM/DD/YYYY, reparto en dos líneas, anexo sin HTML inyectado", () => {
    expect(usDate("2027-03-05")).toBe("03/05/2027");
    expect(usDate("31/12/2026")).toBe("");
    expect(splitOverLines("A B", "legal_description", "legal_description_2")).toEqual(["A B", ""]);
    expect(attachmentHtml([{ heading: "X", body: "<b>1</b>\n2" }], "1 Main St")).toContain("&lt;b&gt;1&lt;/b&gt;<br>2");
  });

  it("el endpoint usa esta función y la descripción legal verificada con el condado", () => {
    const route = readFileSync("src/app/api/agreement/create/route.ts", "utf8");
    expect(route).toContain("const verifiedLegal = await verifiedLegalDescription(property).catch(() => null);");
    expect(route).toContain("textTabs: contract.text,");
    expect(route).not.toMatch(/property_description|legal_description: property\./);
  });
});
