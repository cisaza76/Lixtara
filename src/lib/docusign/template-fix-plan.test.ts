// Plan de arreglos de la plantilla del Listing Agreement (ERS-21tn): con los errores que tenía
// la plantilla Demo (2026-10-21), y que aplicarlo una vez deja la plantilla igual al layout. Sin red.
import { describe, it, expect } from "vitest";
import { ERS21TN_FIELDS } from "./ers21tn-layout";
import { formatPlan, planTemplateFixes, type LiveSellerTabs, type PlanStep } from "./template-fix-plan";

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
    ],
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

  it("compensación al agente del comprador: «%» en la línea 145 y «$» en la 146", () => {
    expect(find(steps, "buyer_comp_pct")[0].changes?.tabLabel).toEqual(["buyer_agent_commission", "buyer_comp_pct"]);
    expect(find(steps, "buyer_comp_amount", "create")).toHaveLength(1);
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
