// Generates the field map of each DocuSign template (docs/docusign/field-map-<form>.md) from a
// dump of the live templates (scripts/docusign/dump-templates.ts) and from the code.
//
//   pnpm tsx scripts/docusign/field-map.ts --from docs/docusign/live-demo-2026-10-21
//
// Needs pdftotext, pdftoppm and tesseract (Homebrew: poppler, tesseract): line numbers come
// from the form's left margin, by text layer when the PDF has one and by OCR when it's a scan.
// The map never prints an email; the only signer values are the test-envelope examples in ERS_NOTES.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { ERS21TN_FIELDS, ERS21TN_SELLER_SIGNATURES, ERS21TN_TEXT_HEIGHT } from "../../src/lib/docusign/ers21tn-layout";
import { TEMPLATE_ENVS } from "./dump-templates";

type Tab = Record<string, unknown> & { tabLabel?: string; pageNumber?: string; xPosition?: string; yPosition?: string; width?: string; height?: string };
type Line = { n: number; page: number; y: number; words: Array<{ x: number; t: string }> };

const from = process.argv[process.argv.indexOf("--from") + 1];
if (!from || !existsSync(from)) throw new Error("--from <dump dir> (scripts/docusign/dump-templates.ts)");
const tmp = mkdtempSync(join(tmpdir(), "fieldmap-"));

// ── Where each value comes from (the code) ──
const ERS_SOURCE: Record<string, string> = {
  seller_name: "Perfil del vendedor (`users.first_name` + `last_name`; si no hay, el correo)",
  broker_name: "`BROKERAGE_LICENSED_ENTITY` (`src/lib/broker.ts`)",
  start_date: "Fecha de creación del sobre",
  termination_date: "Inicio + `termMonths` del plan (`pricing-tiers.ts`)",
  street_address: "`properties.address_street` (con unidad)",
  city_state_zip: "`address_city`, `address_state` `address_zip`",
  city: "`address_city` (se quita: va en `city_state_zip`)",
  state: "`address_state` (se quita)",
  zip: "`address_zip` (se quita)",
  legal_description: "Condado, verificado al firmar (`verifiedLegalDescription`: misma dirección → mismo folio)",
  legal_description_2: "Segunda línea de la descripción legal verificada",
  legal_see_attachment: "Marcada si no hay descripción legal verificada o no cabe en L15–L16",
  personal_property: "Paso 3, electrodomésticos incluidos (`properties.appliances`)",
  personal_property_see_attachment: "Marcada si la lista no cabe en L17",
  occupancy: "Paso 3, `occupancy_status` (inquilino → is; vacía u ocupada por el dueño → is not)",
  occupancy_status: "Paso 3, `occupancy_status` (se quita: pasa a `occupancy`)",
  lease_end_date: "Paso 3, `lease_end_date` (MM/DD/YYYY, solo con inquilino; vacía con «No la sé»)",
  list_price: "Paso 3, `list_price` (sin «$»)",
  financing_cash: "Paso 3, `financing_terms` incluye cash",
  financing_conventional: "Paso 3, `financing_terms` incluye conventional",
  financing_va: "Paso 3, `financing_terms` incluye va",
  financing_fha: "Paso 3, `financing_terms` incluye fha",
  financing_other: "Paso 3, `financing_terms` incluye other",
  financing_other_specify: "Paso 3, `financing_other` (solo con Other)",
  cash_only: "Paso 3, `cash_only` (pasa a `financing_cash`)",
  commission_pct: "Plan, `commissionPct` (sin «%»)",
  flat_fee: "Vacío y de solo lectura: la tarifa fija se cobra en el checkout (párrafo 15)",
  buyer_comp_option: "Paso 6: 10(b) si ofrece compensación (> 0; la paga el vendedor, aparte de la comisión de Lixtara), 10(c) con 0%; nunca 10(a)",
  buyer_comp_pct: "Paso 6, oferta en % (sin «%»), L150 = 10(b)",
  buyer_comp_amount: "Paso 6, oferta en monto fijo (sin «$»), L150 = 10(b)",
  buyer_agent_commission: "Paso 6 (pasa a `buyer_comp_pct` / `buyer_comp_amount`)",
  buyer_commission_ack: "Paso 6 (se quita: marcaba 10(a); pasa a `buyer_comp_option`)",
  single_agent_broker: "`BROKERAGE.legalName` (`src/config/brokerage.ts`)",
  transaction_broker: "`BROKERAGE.legalName` (`src/config/brokerage.ts`)",
  brokerage_firm_name: "`BROKERAGE.legalName` (`src/config/brokerage.ts`)",
  brokerage_phone: "`CONTACT.phoneDisplay` (`src/config/contact.ts`)",
  brokerage_address: "`BROKERAGE.address` (`src/config/brokerage.ts`)",
  lockbox_authorized: "Plan: Concierge siempre; Pro si la casa está vacía",
  protection_period_days: "`PROTECTION_PERIOD_DAYS` (`src/config/listing-agreement.ts`): 90 días",
  retained_deposits_pct: "`RETAINED_DEPOSITS_PCT` (`src/config/listing-agreement.ts`): 0 (sin «%»)",
  cancellation_fee: "Vacío y de solo lectura: el párrafo 12 no aplica (párrafo 15 (3))",
  ...Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`additional_terms_${i + 1}`, `\`additionalTermsClauses()\` (\`listing-agreement-tabs.ts\`), línea ${i + 1} de 15: tarifa fija, comisión solo al cierre, terminación sin cargo, período de protección; cada cláusula empieza en una línea`])),
  single_agent_signature: "Firma del vendedor en el aviso de single agent (L171); L173 (segundo vendedor) sin tab: el sitio tiene un vendedor por acuerdo",
  single_agent_date: "Fecha de firma del vendedor (L171)",
  transition_consent_signature: "Firma del vendedor en el consentimiento a transaction broker (L201); L203 sin tab",
  transition_consent_date: "Fecha de firma del vendedor (L201)",
};
const CASSB1_SOURCE: Record<string, string> = {
  fee_amount: "`cassb1Tabs`: monto fijo (hoy apagado: `CASSB1_ENABLED = false`)",
  fee_pct_value: "`cassb1Tabs`: % del precio (hoy apagado: `CASSB1_ENABLED = false`)",
};
const SOURCES: Record<string, Record<string, string>> = { "ERS-21tn": ERS_SOURCE, "CASSB-1": CASSB1_SOURCE };

// Errors the heuristics can't see, checked on the envelope of 2026-10-20 (what the site sent vs
// what the signer ended up with) and on a completed envelope (2026-10-15).
const ERS_NOTES: Record<string, string> = {
  street_address: "**la dirección completa (con ciudad, estado y ZIP) y además ciudad, estado y ZIP aparte: repetida**",
  legal_description:
    "**el sitio la mandó vacía (el condado no la devolvió) y, por ser obligatoria y editable, quien firmó escribió «three-bedroom townhouses»; la del condado tiene varias líneas y desbordaba hasta L18**",
  personal_property: "**dos campos: L17 y un cuadro que crece sobre L18–L20**",
  lease_end_date: "**obligatorio aunque no haya inquilino: quien firmó escribió «31/12/2026» (DD/MM)**",
  occupancy_status: "**las dos casillas (is / is not) tienen la misma etiqueta: el sitio mandó las dos sin marcar y, al marcar una, DocuSign marcó las dos**",
  "Text 83050f56-a8c7-4790-bf15-47bd814d2d41":
    "**es «Other (specify)» de L23: obligatorio y sin condición, obligó a escribir algo aunque «Other» no esté marcado («Cash» el 2026-10-20)**",
  list_price: "**«$» repetido: el formulario imprime «$» y el sitio mandaba «$650,000»**",
  commission_pct: "**«%» repetido: el sitio mandaba «1%» antes del «%» impreso**",
  flat_fee: "**«$» repetido: «$495» después del «$» impreso**",
  buyer_agent_commission: "**«%» repetido, y un monto fijo («$12,000») caía en la línea del porcentaje; el monto va en L146**",
};
const NOTES: Record<string, Record<string, string>> = { "ERS-21tn": ERS_NOTES };
const IN_USE: Record<string, string> = {
  "ERS-21tn": "En uso: `POST /api/agreement/create` (paso 7).",
  "CASSB-1": "No se usa hoy (`CASSB1_ENABLED = false` en `src/lib/buyer-comp.ts`).",
  "AS-IS": "No se usa hoy: ningún código crea sobres con esta plantilla.",
  "CA-8": "No se usa hoy: ningún código crea sobres con esta plantilla.",
};

// ── Lines of the form (margin numbers) ──
function linesFromTextLayer(pdf: string): Line[] {
  const html = execFileSync("pdftotext", ["-bbox", pdf, "-"]).toString();
  const out: Line[] = [];
  let page = 0;
  const words: Array<{ page: number; x: number; y: number; t: string }> = [];
  for (const m of html.matchAll(/<page [^>]*>|<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
    if (m[0].startsWith("<page")) page++;
    else words.push({ page, x: Number(m[1]), y: (Number(m[2]) + Number(m[3])) / 2, t: m[4] });
  }
  // Margin numbers (left of x = 45, below the DocuSign header).
  for (const w of words) if (w.x < 45 && w.y > 20 && /^\d{1,3}$/.test(w.t)) out.push({ n: Number(w.t), page: w.page, y: w.y, words: [] });
  if (out.length === 0) {
    // Form without numbered lines (CASSB-1, CA-8): one row per printed line of text, n = 0.
    for (const w of words) {
      if (w.y < 20) continue;
      const row = out.find((l) => l.page === w.page && Math.abs(l.y - w.y) < 3);
      if (!row) out.push({ n: 0, page: w.page, y: w.y, words: [] });
    }
  }
  for (const l of out) l.words = words.filter((w) => w.page === l.page && Math.abs(w.y - l.y) < 4 && w.x >= 45).map((w) => ({ x: w.x, t: w.t }));
  return out;
}

async function linesByOcr(pdf: string, key: string): Promise<Line[]> {
  const prefix = join(tmp, key);
  execFileSync("pdftoppm", ["-r", "144", "-png", pdf, prefix]);
  const out: Line[] = [];
  for (let page = 1; existsSync(`${prefix}-${page}.png`); page++) {
    const png = `${prefix}-${page}.png`;
    // Margin numbers: OCR of the left strip, enlarged ×3 (whole-page OCR misses some).
    await sharp(png).extract({ left: 20, top: 40, width: 70, height: 1500 }).resize({ width: 210 }).toFile(`${prefix}-m${page}.png`);
    execFileSync("tesseract", [`${prefix}-m${page}.png`, `${prefix}-m${page}`, "--psm", "6", "tsv"], { stdio: "ignore" });
    execFileSync("tesseract", [png, `${prefix}-w${page}`, "--psm", "4", "tsv"], { stdio: "ignore" });
    const tsv = (f: string) =>
      readFileSync(f, "utf8").split("\n").slice(1).map((r) => r.split("\t")).filter((c) => c[0] === "5" && c[11]?.trim());
    const words = tsv(`${prefix}-w${page}.tsv`).map((c) => ({ x: Number(c[6]) / 2, y: (Number(c[7]) + Number(c[9]) / 2) / 2, t: c[11] }));
    for (const c of tsv(`${prefix}-m${page}.tsv`)) {
      if (!/^\d{1,3}$/.test(c[11])) continue;
      const y = (40 + (Number(c[7]) + Number(c[9]) / 2) / 3) / 2;
      out.push({ n: Number(c[11]), page, y, words: words.filter((w) => Math.abs(w.y - y) < 5 && w.x > 45).map(({ x, t }) => ({ x, t })) });
    }
  }
  return out;
}

// ── One row per tab ──
const num = (v: unknown) => Number(v ?? NaN);
const isCheck = (kind: string) => kind === "checkboxTabs" || kind === "radioGroupTabs";

function rowFor(key: string, role: string, kind: string, t: Tab, lines: Line[], dupLabels: Set<string>) {
  const page = num(t.pageNumber);
  const h = num(t.height) || 0;
  const cy = isCheck(kind) ? num(t.yPosition) + 8 : num(t.yPosition) + h / 2;
  const onPage = lines.filter((l) => l.page === page);
  const line = [...onPage].sort((a, b) => Math.abs(a.y - cy) - Math.abs(b.y - cy))[0];
  const covered = onPage.filter((l) => l.y > num(t.yPosition) + 2 && l.y < num(t.yPosition) + h - 2).map((l) => l.n).sort((a, b) => a - b);
  // Printed text right before the field on its line (or, for a field at the start of the line, right after it).
  const before = line ? line.words.filter((w) => w.x < num(t.xPosition) + 4).map((w) => w.t).slice(-6) : [];
  const after = line && before.length === 0 ? line.words.filter((w) => w.x >= num(t.xPosition)).map((w) => w.t).slice(0, 6) : [];
  const decode = (s: string) =>
    s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/_{4,}/g, "___");
  const label = decode(before.length ? before.join(" ") : after.length ? `… ${after.join(" ")}` : "");
  const name = String(t.tabLabel ?? t.groupName ?? "");
  const locked = t.locked === "true";
  const required = t.required === "true";
  const source = SOURCES[key]?.[name] ?? (String(t.value ?? "") && locked ? "Fijo en la plantilla" : role === "Seller" || role === "Buyer" ? "Lo llena quien firma" : "Lo llena quien firma (" + role + ")");
  const errors: string[] = [];
  if (/^(Text|Checkbox|Radio) [0-9a-f]{8}/.test(name)) errors.push("sin nombre: el código no puede llenarlo ni condicionarlo");
  if (dupLabels.has(`${kind}:${name}`)) errors.push(isCheck(kind) ? "misma etiqueta en varias casillas: marcar una marca todas" : "campo duplicado (misma etiqueta dos veces)");
  if (!isCheck(kind) && kind !== "signHereTabs" && kind !== "initialHereTabs" && h > 14) errors.push(`alto ${h} pt: más de una línea`);
  if (covered.length > 1 && covered[0] > 0) errors.push(`tapa las líneas ${covered.join(", ")}`);
  else if (covered.length > 1) errors.push(`tapa ${covered.length} renglones del texto`);
  if (num(t.xPosition) + (num(t.width) || 0) > 600) errors.push("se sale del margen derecho");
  if (kind === "textTabs" && t.disableAutoSize !== "true" && !/^lixtara_footer/.test(name)) errors.push("auto-grow activo");
  if (required && !locked && source.startsWith("Lo llena") && kind === "textTabs") errors.push("obligatorio y editable: obliga a escribir algo aunque no aplique");
  if (t.extensionData) errors.push("extensión de DocuSign (Smarty) sobre el texto, obligatoria");
  if (SOURCES[key]?.[name] && !locked && kind === "textTabs") errors.push("dato del sitio editable por el vendedor");
  if (NOTES[key]?.[name]) errors.unshift(NOTES[key][name]);
  return {
    line: !line || line.n === 0 ? "—" : covered.length > 1 ? `${covered[0]}–${covered[covered.length - 1]}` : String(line.n),
    sortKey: page * 10000 + num(t.yPosition) * 10 + num(t.xPosition) / 100,
    name: name.length > 40 ? `${name.slice(0, 37)}…` : name,
    label: label.replace(/\|/g, "/") || "—",
    type: kind.replace("Tabs", "").replace("radioGroup", "radio"),
    role,
    source,
    required: required ? "sí" : "no",
    editable: locked ? "no" : "sí",
    geometry: `p${page} x${t.xPosition} y${t.yPosition}${t.width ? ` · ${t.width}×${t.height}` : ""}${t.fontSize ? ` · ${String(t.fontSize).replace("size", "")} pt` : ""}`,
    grow: kind === "textTabs" ? (t.disableAutoSize === "true" ? "no" : "sí") : "—",
    errors: errors.join("; ") || "—",
  };
}

async function mapFor(key: string): Promise<string> {
  const j = JSON.parse(readFileSync(join(from, `${key}.json`), "utf8"));
  const pdf = join(from, `${key}.pdf`);
  const hasText = execFileSync("pdftotext", [pdf, "-"]).toString().trim().length > 50;
  const lines = hasText ? linesFromTextLayer(pdf) : await linesByOcr(pdf, key);
  const rows: ReturnType<typeof rowFor>[] = [];
  const roles: string[] = [];
  for (const r of j.recipients.signers ?? []) {
    roles.push(`${r.roleName} (orden ${r.routingOrder})`);
    const tabs = (r.tabs ?? {}) as Record<string, Tab[]>;
    const count = new Map<string, number>();
    for (const [kind, arr] of Object.entries(tabs)) for (const t of arr) count.set(`${kind}:${t.tabLabel}`, (count.get(`${kind}:${t.tabLabel}`) ?? 0) + 1);
    const dup = new Set([...count].filter(([k, c]) => c > 1 && !/:(Signature|Initial|Date Signed)/.test(k)).map(([k]) => k));
    for (const [kind, arr] of Object.entries(tabs)) {
      if (kind === "tabGroups") continue;
      for (const t of arr) {
        if (/^lixtara_footer_p\d_l2$/.test(String(t.tabLabel))) continue; // same as l1
        const row = rowFor(key, r.roleName, kind, t, lines, dup);
        if (/^lixtara_footer/.test(String(t.tabLabel))) Object.assign(row, { name: "lixtara_footer_p*", label: "pie de página (una por página)", line: "—" });
        if (/^(signHere|initialHere|dateSigned)/.test(kind) && rows.some((x) => x.type === row.type && x.role === row.role && kind === "initialHereTabs")) continue;
        rows.push(row);
      }
    }
  }
  rows.sort((a, b) => a.sortKey - b.sortKey);
  const errs = rows.filter((r) => r.errors !== "—").length;
  const md = [
    `# Mapa de campos · ${j.name}`,
    "",
    `Generado con \`scripts/docusign/field-map.ts\` desde la plantilla de la cuenta Demo (\`${j.templateId}\`, ${from.split("/").pop()}) y el código. ${IN_USE[key]}`,
    `PDF: ${hasText ? "con capa de texto (se pueden usar anclas)" : "imagen escaneada, sin texto (no se pueden usar anclas: posiciones por coordenadas)"}. Roles: ${roles.join(", ")}.`,
    "",
    `**${rows.length} campos, ${errs} con errores.** Posición en puntos desde la esquina superior izquierda; «editable» = lo puede cambiar quien firma.`,
    "",
    "| Línea | Campo (tabLabel) | Etiqueta en el formulario | Tipo | Rol | Origen del dato | Obligatorio | Editable | Posición y tamaño | Auto-grow | Errores |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.line} | \`${r.name}\` | ${r.label} | ${r.type} | ${r.role} | ${r.source} | ${r.required} | ${r.editable} | ${r.geometry} | ${r.grow} | ${r.errors} |`),
  ];
  return md.join("\n");
}

function ersAfter(): string {
  const rows = ERS21TN_FIELDS.map((f) => {
    const name = f.kind === "radio" ? f.groupName : f.label;
    const geo =
      f.kind === "text"
        ? `p${f.page} x${Math.round(f.x)} y${Math.round(f.y)} · ${Math.round(f.width)}×${ERS21TN_TEXT_HEIGHT} · 9 pt`
        : f.kind === "checkbox"
          ? `p${f.page} x${Math.round(f.x)} y${Math.round(f.y)}`
          : f.radios.map((r) => `${r.value}: p${f.page} x${Math.round(r.x)} y${Math.round(r.y)}`).join(" · ");
    const cond = f.kind === "text" && f.conditional ? `solo si \`${f.conditional.parentLabel}\` = ${f.conditional.parentValue}` : "—";
    return `| ${f.line} | \`${name}\` | ${f.kind} | ${ERS_SOURCE[name] ?? "Lo llena quien firma"} | ${"required" in f && f.required ? "sí" : "no"} | ${f.locked ? "no" : "sí"} | ${geo} | ${f.kind === "text" ? "no" : "—"} | ${cond} |`;
  });
  for (const f of ERS21TN_SELLER_SIGNATURES) {
    const geo = `p${f.page} x${Math.round(f.x)} y${Math.round(f.y)}${f.scale ? ` · escala ${f.scale}` : " · 9 pt"}`;
    rows.push(`| ${f.line} | \`${f.label}\` | ${f.kind.replace("Tabs", "")} | ${ERS_SOURCE[f.label] ?? "Lo llena quien firma"} | sí | — | ${geo} | — | — |`);
  }
  return [
    "",
    "## Después del arreglo (`scripts/docusign/apply-template-fixes.ts`)",
    "",
    "Campos que llena el sitio, con su posición nueva (`src/lib/docusign/ers21tn-layout.ts`). Las iniciales del vendedor y de la broker pasan al espacio «Seller (____)» / «Broker/Authorized Associate (____)» del pie de cada página (`ERS21TN_INITIALS`, escala 0.5). El vendedor firma y fecha además el aviso de single agent (L171) y el consentimiento a transaction broker (L201) (`ERS21TN_SELLER_SIGNATURES`, escala 0.65); L173 y L203 (segundo vendedor) quedan en blanco: el sitio tiene un vendedor por acuerdo. La firma y la fecha de la página 6 y el pie de Lixtara no cambian.",
    "",
    "| Línea | Campo | Tipo | Origen del dato | Obligatorio | Editable | Posición y tamaño | Auto-grow | Condición |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

async function main() {
  for (const t of TEMPLATE_ENVS) {
    if (!existsSync(join(from, `${t.key}.json`))) continue;
    const out = `docs/docusign/field-map-${t.key.toLowerCase().replace(/[^a-z0-9]/g, "")}.md`;
    const md = (await mapFor(t.key)) + (t.key === "ERS-21tn" ? `\n${ersAfter()}\n` : "\n");
    writeFileSync(out, md);
    console.log(`✓ ${out}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
