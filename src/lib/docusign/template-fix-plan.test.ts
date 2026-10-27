// Plan de arreglos de la plantilla del Listing Agreement (ERS-21tn): con los errores que tenía
// la plantilla Demo (2026-10-21), y que aplicarlo una vez deja la plantilla igual al layout. Sin red.
import { describe, it, expect } from "vitest";
import { ERS21TN_BROKER_SIGNATURES, ERS21TN_FIELDS, ERS21TN_INITIALS, ERS21TN_SELLER_SIGNATURES } from "./ers21tn-layout";
import { formatPlan, planInitialFixes, planSignatureFixes, planTemplateFixes, type LiveSellerTabs, type PlanStep } from "./template-fix-plan";

let n = 0;
const tab = (tabLabel: string, page: number, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  tabId: `t${++n}`,
  tabLabel,
  pageNumber: String(page),
  xPosition: String(x),
  yPosition: String(y),
  width: "120",
  height: "19",
  fontSize: "size9",
  disableAutoSize: "false",
  locked: "false",
  required: "true",
  ...extra,
});

// The Demo template as it was (subset with every kind of error).
function demoTemplate(): LiveSellerTabs {
  n = 0;
  return {
    textTabs: [
      tab("seller_name", 1, 49, 77),
      tab("street_address", 1, 169, 226, { extensionData: { actionInputKey: "street1" } }),
      tab("legal_description", 1, 164, 264, { width: "480", height: "21" }),
      tab("personal_property", 1, 280, 305),
      tab("personal_property", 1, 84, 319, { height: "23" }),
      tab("city", 1, 472, 224),
      tab("state", 1, 86, 245),
      tab("zip", 1, 294, 244),
      tab("lease_end_date", 1, 482, 348),
      tab("Text 83050f56-a8c7-4790-bf15-47bd814d2d41", 1, 435, 389),
      tab("buyer_agent_commission", 3, 500, 490, { locked: "true" }),
      tab("lixtara_footer_p1_l1", 1, 200, 760, { locked: "true", required: "false" }),
    ],
    checkboxTabs: [
      tab("occupancy_status", 1, 124, 357, { tabGroupLabels: ["G1"] }),
      tab("occupancy_status", 1, 150, 356, { tabGroupLabels: ["G2"] }),
      tab("cash_only", 1, 170, 397),
      tab("Checkbox 18617c6f", 1, 211, 397),
      tab("Checkbox 1cd98371", 1, 287, 396),
      tab("Checkbox 6f2d0843", 1, 317, 397),
      tab("Checkbox 4ac2b140", 1, 355, 397),
      tab("buyer_commission_ack", 3, 119, 494),
    ],
    // Seller initials as they were: ~40 pt above the footer (p6 on the form's own footer).
    initialHereTabs: [1, 2, 3, 4, 5].map((p) => tab(`Initial s${p}`, p, 73, 685)).concat(tab("Initial s6", 6, 88, 729)),
    listTabs: [tab("com.docusign.extensibilityplatform.action.verify.postaladdress@1.0.0.VerifyPostalAddressInput[0].countryOrRegion", 1, 166, 247)],
    tabGroups: [{ tabId: "g1", groupLabel: "G1" }, { tabId: "g2", groupLabel: "G2" }, { tabId: "g3", groupLabel: "G3" }],
  };
}

/** What DocuSign would hold after the plan (deletes, updates, creates). */
function applyLocally(live: LiveSellerTabs, steps: PlanStep[]): LiveSellerTabs {
  const out = structuredClone(live) as Record<string, Array<Record<string, unknown>>>;
  for (const s of steps) {
    const arr = (out[s.kind] ??= []);
    if (s.action === "delete") out[s.kind] = arr.filter((t) => t.tabId !== s.tabId);
    if (s.action === "update") Object.assign(arr.find((t) => t.tabId === s.tabId)!, Object.fromEntries(Object.entries(s.changes ?? {}).map(([k, [, v]]) => [k, v])));
    if (s.action === "create") arr.push({ ...s.tab, tabId: `new-${s.label}` });
  }
  return out as LiveSellerTabs;
}

const find = (steps: PlanStep[], label: string, action?: PlanStep["action"]) => steps.filter((s) => s.label === label && (!action || s.action === action));

describe("arreglos de la plantilla ERS-21tn", () => {
  const steps = planTemplateFixes(demoTemplate());

  it("ocupación: los dos checkboxes con la misma etiqueta salen; entra un grupo de opción única", () => {
    expect(find(steps, "occupancy_status", "delete")).toHaveLength(2);
    const radio = find(steps, "occupancy", "create")[0];
    expect((radio.tab as { radios: Array<{ value: string }> }).radios.map((r) => r.value)).toEqual(["is", "is_not"]);
    // Sus grupos de checkbox quedan vacíos y se borran; los demás no.
    expect(steps.filter((s) => s.kind === "tabGroups").map((s) => s.tabId)).toEqual(["g1", "g2"]);
  });

  it("lease expires: no obligatorio y solo con «is»", () => {
    expect(find(steps, "lease_end_date")[0].changes).toMatchObject({
      required: ["true", "false"],
      conditionalParentLabel: ["", "occupancy"],
      conditionalParentValue: ["", "is"],
    });
  });

  it("Other (specify): el campo sin nombre pasa a financing_other_specify, condicionado a «Other»; la casilla sin nombre, a financing_other", () => {
    expect(find(steps, "financing_other_specify")[0].changes).toMatchObject({
      tabLabel: ["Text 83050f56-a8c7-4790-bf15-47bd814d2d41", "financing_other_specify"],
      conditionalParentLabel: ["", "financing_other"],
      conditionalParentValue: ["", "on"],
    });
    expect(find(steps, "financing_other")[0].changes?.tabLabel).toEqual(["Checkbox 4ac2b140", "financing_other"]);
    expect(find(steps, "financing_cash")[0].changes?.tabLabel).toEqual(["cash_only", "financing_cash"]);
  });

  it("personal property: queda uno, en la línea 17, de una línea; el otro se borra", () => {
    expect(find(steps, "personal_property", "update")).toHaveLength(1);
    expect(find(steps, "personal_property", "delete")).toHaveLength(1);
    expect(find(steps, "personal_property_see_attachment", "create")).toHaveLength(1);
  });

  it("campos de texto: tamaño fijo a la línea, 9 pt, sin auto-grow; lo del sitio, bloqueado", () => {
    const seller = find(steps, "seller_name")[0].changes!;
    expect(seller).toMatchObject({ height: ["19", "11"], disableAutoSize: ["false", "true"], locked: ["false", "true"] });
    expect(find(steps, "legal_description")[0].changes).toMatchObject({ width: ["480", "402"], required: ["true", "false"] });
  });

  it("dirección en dos líneas; la lista de país de Smarty sale; el pie de página no se toca", () => {
    // street_address era entrada de la extensión Smarty: se borra y se crea como campo normal.
    expect(find(steps, "street_address").map((s) => s.action)).toEqual(["delete", "create"]);
    for (const l of ["city", "state", "zip"]) expect(find(steps, l, "delete")).toHaveLength(1);
    expect(find(steps, "city_state_zip", "create")).toHaveLength(1);
    expect(find(steps, "Smarty country list", "delete")).toHaveLength(1);
    expect(steps.some((s) => s.label.startsWith("lixtara_footer"))).toBe(false);
  });

  it("compensación al broker del comprador: una opción bloqueada del párrafo 10; «%» y «$» en la línea 150 (10(b))", () => {
    const pct = find(steps, "buyer_comp_pct")[0].changes!;
    expect(pct.tabLabel).toEqual(["buyer_agent_commission", "buyer_comp_pct"]);
    expect(Number(pct.yPosition[1])).toBeGreaterThan(550);
    expect(find(steps, "buyer_comp_amount", "create")).toHaveLength(1);
    // La casilla vieja marcaba 10(a) (sale de la comisión del Broker): se borra.
    expect(find(steps, "buyer_commission_ack", "delete")).toHaveLength(1);
    const radio = find(steps, "buyer_comp_option", "create")[0].tab as { radios: Array<{ value: string; locked: string; pageNumber: string }> };
    expect(radio.radios.map((r) => r.value)).toEqual(["a", "b", "c"]);
    expect(radio.radios.every((r) => r.locked === "true" && r.pageNumber === "3")).toBe(true);
  });

  it("iniciales: las del vendedor y las de la broker van al espacio del pie de cada página, más chicas", () => {
    const seller = planInitialFixes(demoTemplate(), "Seller");
    expect(seller).toHaveLength(6);
    for (const s of seller) expect(s.changes).toMatchObject({ yPosition: [expect.any(String), "708"], scaleValue: ["", "0.5"] });
    expect(seller.find((s) => s.label === "Seller initials p1")!.changes!.xPosition).toEqual(["73", "81"]);
    // Sin iniciales de la broker en el ejemplo: se crean, una por página.
    const broker = planInitialFixes({}, "Broker");
    expect(broker.map((s) => s.action)).toEqual(Array(6).fill("create"));
    expect(broker.map((s) => (s.tab as { xPosition: string }).xPosition)).toEqual(Array(6).fill("270"));
    // Dentro del espacio de 24 pt de cada parte, y por debajo del texto de la página (y 712).
    for (const i of ERS21TN_INITIALS) expect(i.x).toBeGreaterThanOrEqual(i.role === "Seller" ? 77 : 266);
    const after = applyLocally(demoTemplate(), seller);
    expect(planInitialFixes(after, "Seller")).toEqual([]);
  });

  it("firmas del vendedor: aviso de single agent (L171) y consentimiento a transaction broker (L201), con fecha; sin segundo vendedor", () => {
    // La plantilla tenía solo la firma y la fecha de la página 6: se crean las cuatro de la página 4.
    const live: LiveSellerTabs = { signHereTabs: [tab("Signature", 6, 163, 10)], dateSignedTabs: [tab("Date Signed", 6, 444, 28)] } as LiveSellerTabs;
    const plan = planSignatureFixes(live);
    expect(plan.map((s) => [s.action, s.kind, s.label])).toEqual([
      ["create", "signHereTabs", "single_agent_signature"],
      ["create", "dateSignedTabs", "single_agent_date"],
      ["create", "signHereTabs", "transition_consent_signature"],
      ["create", "dateSignedTabs", "transition_consent_date"],
    ]);
    for (const s of plan) expect(s.tab).toMatchObject({ pageNumber: "4", documentId: "1" });
    expect(plan.filter((s) => s.kind === "signHereTabs").every((s) => (s.tab as Record<string, string>).optional === "false")).toBe(true);
    // Sobre la línea de firma (L171 en y 255, L201 en y 666), sin pisar el texto de arriba (termina en 232.7 y 643.7).
    const sig = (l: string) => ERS21TN_SELLER_SIGNATURES.find((f) => f.label === l)!;
    for (const [l, top, line] of [["single_agent_signature", 232.7, 255], ["transition_consent_signature", 643.7, 666]] as const) {
      const f = sig(l);
      expect(f.y + 4 * f.scale!).toBeGreaterThan(top);
      expect(f.y + 37.5 * f.scale!).toBeLessThanOrEqual(line + 2);
    }
    // Ningún tab en L173 ni L203 (segundo vendedor): el sitio tiene un vendedor por acuerdo.
    expect(ERS21TN_SELLER_SIGNATURES.map((f) => f.line)).toEqual([171, 171, 201, 201]);
    // La firma de la página 6 no se toca, y aplicado una vez el plan queda vacío.
    expect(plan.some((s) => s.label === "Signature" || s.label === "Date Signed")).toBe(false);
    expect(planSignatureFixes(applyLocally(live, plan))).toEqual([]);
  });

  it("página 6: contacto del vendedor en L247–249 y «email» en L257, de solo lectura; la fecha de L257 es la firma de la broker", () => {
    const plan = planTemplateFixes(demoTemplate());
    for (const [label, line] of [["seller_phone", 247], ["seller_address", 248], ["seller_email", 249]] as const) {
      const s = find(plan, label)[0];
      expect(s.action, label).toBe("create");
      expect(s.tab, label).toMatchObject({ pageNumber: "6", locked: "true", height: "11", disableAutoSize: "true" });
      expect(ERS21TN_FIELDS.find((f) => f.kind === "text" && f.label === label)?.line).toBe(line);
    }
    // Encima de su raya (L247 y 69.7, L248 y 92.7, L249 y 116.1), sin pasar a la de abajo.
    expect(find(plan, "seller_phone")[0].tab).toMatchObject({ xPosition: "135", yPosition: "56", width: "96" });
    expect(find(plan, "seller_email")[0].tab).toMatchObject({ yPosition: "102" });
    const box = find(plan, "copy_returned_by_email")[0];
    expect(box.tab).toMatchObject({ pageNumber: "6", locked: "true", xPosition: "330", yPosition: "304" });
    // La fecha la pone DocuSign: dateSigned de la broker (firma la última), no un texto del sitio.
    const broker = planSignatureFixes({}, ERS21TN_BROKER_SIGNATURES, "broker");
    expect(broker.map((s) => [s.action, s.kind, s.label])).toEqual([["create", "dateSignedTabs", "copy_returned_date"]]);
    expect(broker[0].tab).toMatchObject({ pageNumber: "6", xPosition: "194", yPosition: "302" });
    expect(broker[0].reason).toMatch(/^broker's date, line 257/);
    expect(planSignatureFixes(applyLocally({}, broker), ERS21TN_BROKER_SIGNATURES, "broker")).toEqual([]);
  });

  it("aplicado una vez, el siguiente plan está vacío (idempotente)", () => {
    const after = applyLocally(demoTemplate(), planTemplateFixes(demoTemplate()));
    expect(formatPlan(planTemplateFixes(after))).toMatch(/^\n?0 to update, 0 to create, 0 to delete\.$/);
  });

  it("cada campo del layout termina en la plantilla", () => {
    const after = applyLocally(demoTemplate(), planTemplateFixes(demoTemplate())) as Record<string, Array<Record<string, unknown>>>;
    const labels = new Set([...(after.textTabs ?? []), ...(after.checkboxTabs ?? [])].map((t) => t.tabLabel).concat((after.radioGroupTabs ?? []).map((g) => g.groupName)));
    for (const f of ERS21TN_FIELDS) expect(labels.has(f.kind === "radio" ? f.groupName : f.label), f.kind === "radio" ? f.groupName : f.label).toBe(true);
  });

  it("con --anchors, los campos con ancla la llevan", () => {
    const withAnchors = planTemplateFixes(demoTemplate(), { anchors: true });
    expect(find(withAnchors, "legal_description")[0].changes?.anchorString).toEqual(["", "Legal Description:"]);
  });
});
