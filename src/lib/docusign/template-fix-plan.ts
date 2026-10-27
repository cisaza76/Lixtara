// Plan of changes to the Listing Agreement template (ERS-21tn), from the live template's
// tabs to the layout in ers21tn-layout.ts. Pure: scripts/docusign/apply-template-fixes.ts
// fetches the template, prints this plan (--dry-run) and applies it (--apply).
//
// What it fixes (field map: docs/docusign/field-map-ers21tn.md):
//   - every field the site fills: fixed to its line (one line, 9 pt, no auto-grow);
//   - site data (price, address, names, dates, plan, commission) locked for the seller;
//   - occupancy "is / is not" = one radio group (they were two checkboxes with the same label,
//     so checking one checked both); lease expiry only with "is";
//   - "Other (specify)" only with "Other" checked, and no longer required;
//   - one personal property field (there were two), "See Attachment" boxes on lines 16 and 18;
//   - city/state/ZIP in one field on line 14; the Smarty address-verification country list
//     (required, over lines 13–14) removed;
//   - buyer's broker compensation: one locked choice for paragraph 10 (a / b / c; the site
//     sends b, or c with 0%), "%" and "$" on line 150 (10(b)); the old 10(a) box is removed;
//   - brokerage name on lines 159 and 171 (the second), name, phone and address on 255–256;
//   - initials (seller and broker) in their blank of each page's footer;
//   - protection period (L123), retained deposits (L128), cancellation fee (L207) and the
//     additional terms (L230–233), read-only;
//   - the seller's signature and date on the single agent notice (L171) and on the consent to
//     transition to transaction broker (L201).

import {
  ERS21TN_FIELDS,
  ERS21TN_FONT_SIZE_PT,
  ERS21TN_INITIALS,
  ERS21TN_SELLER_SIGNATURES,
  ERS21TN_TEXT_HEIGHT,
  type CheckboxField,
  type LayoutField,
  type RadioGroupField,
  type TextField,
} from "./ers21tn-layout";

export type LiveTab = Record<string, unknown> & {
  tabId?: string;
  tabLabel?: string;
  pageNumber?: string;
  xPosition?: string;
  yPosition?: string;
};

export interface LiveSellerTabs {
  textTabs?: LiveTab[];
  checkboxTabs?: LiveTab[];
  listTabs?: LiveTab[];
  radioGroupTabs?: Array<LiveTab & { groupName?: string; radios?: LiveTab[] }>;
  tabGroups?: LiveTab[];
  initialHereTabs?: LiveTab[];
  signHereTabs?: LiveTab[];
  dateSignedTabs?: LiveTab[];
}

export type TabKind = "textTabs" | "checkboxTabs" | "listTabs" | "radioGroupTabs" | "tabGroups" | "initialHereTabs" | "signHereTabs" | "dateSignedTabs";

export interface PlanStep {
  action: "update" | "create" | "delete";
  kind: TabKind;
  tabId?: string;
  label: string;
  /** Why (for the diff). */
  reason: string;
  /** Property → [before, after] for updates; the full tab for creates. */
  changes?: Record<string, [string, string]>;
  tab?: Record<string, unknown>;
}

const num = (v: unknown) => Number(v ?? NaN);
const fmt = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/** Labels the site no longer sends, and what replaces them. */
const LEGACY_RENAME: Record<string, string> = {
  cash_only: "financing_cash",
  buyer_agent_commission: "buyer_comp_pct",
};
const LEGACY_DELETE: Record<string, string> = {
  city: "city, state and ZIP now go together on line 14 (city_state_zip)",
  state: "city, state and ZIP now go together on line 14 (city_state_zip)",
  zip: "city, state and ZIP now go together on line 14 (city_state_zip)",
  occupancy_status: 'replaced by the radio group "occupancy" (is / is not); with one label for both boxes, checking one checked both',
  buyer_commission_ack: 'replaced by the radio group "buyer_comp_option" (10(a) / (b) / (c)): the site checked 10(a), paid out of Broker\'s compensation',
};

function desiredText(f: TextField, anchors: boolean): Record<string, string> {
  return {
    tabLabel: f.label,
    pageNumber: String(f.page),
    xPosition: String(Math.round(f.x)),
    yPosition: String(Math.round(f.y)),
    width: String(Math.round(f.width)),
    height: String(ERS21TN_TEXT_HEIGHT),
    fontSize: `size${ERS21TN_FONT_SIZE_PT}`,
    disableAutoSize: "true",
    locked: String(f.locked),
    required: String(f.required),
    conditionalParentLabel: f.conditional?.parentLabel ?? "",
    conditionalParentValue: f.conditional?.parentValue ?? "",
    ...(anchors && f.anchor ? { anchorString: f.anchor } : {}),
  };
}

function desiredBox(f: CheckboxField): Record<string, string> {
  return {
    tabLabel: f.label,
    pageNumber: String(f.page),
    xPosition: String(Math.round(f.x)),
    yPosition: String(Math.round(f.y)),
    locked: String(f.locked),
    required: "false",
  };
}

function diff(live: LiveTab, want: Record<string, string>): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {};
  for (const [k, v] of Object.entries(want)) {
    const before = fmt(live[k]);
    if (before !== v && !(before === "" && v === "false")) out[k] = [before, v];
  }
  return out;
}

const near = (t: LiveTab, page: number, x: number, y: number, tol = 14) =>
  num(t.pageNumber) === page && Math.abs(num(t.xPosition) - x) <= tol && Math.abs(num(t.yPosition) - y) <= tol;

/**
 * The plan for the Seller role. `anchors` = also set anchor strings (only when the template's
 * PDF has a text layer; the Demo ERS-21tn is a scanned image).
 */
export function planTemplateFixes(live: LiveSellerTabs, opts: { anchors?: boolean } = {}): PlanStep[] {
  const steps: PlanStep[] = [];
  const used = new Set<string>();
  const texts = live.textTabs ?? [];
  const boxes = live.checkboxTabs ?? [];

  const take = (t: LiveTab | undefined) => {
    if (t?.tabId) used.add(t.tabId);
    return t;
  };

  for (const f of ERS21TN_FIELDS as LayoutField[]) {
    if (f.kind === "text") {
      const want = desiredText(f, Boolean(opts.anchors));
      const legacy = Object.entries(LEGACY_RENAME).find(([, to]) => to === f.label)?.[0];
      // Same label: the one closest to the target (personal_property is on the template twice).
      const sameLabel = texts.filter((t) => t.tabLabel === f.label && !used.has(t.tabId!));
      const dist = (t: LiveTab) => Math.hypot(num(t.xPosition) - f.x, num(t.yPosition) - f.y);
      sameLabel.sort((a, b) => dist(a) - dist(b));
      const found =
        take(sameLabel[0]) ??
        take(texts.find((t) => legacy && t.tabLabel === legacy)) ??
        // "Other (specify)" was an unnamed, required text box at the end of line 23.
        take(f.label === "financing_other_specify" ? texts.find((t) => /^Text /.test(t.tabLabel ?? "") && near(t, 1, 435, 389, 20)) : undefined);
      if (found?.extensionData) {
        // Bound to the Smarty address-verification extension (street1, locality…): removed
        // with it and created again as a plain text field.
        steps.push({ action: "delete", kind: "textTabs", tabId: found.tabId, label: f.label, reason: "input of the Smarty address-verification extension; recreated as a plain field" });
        steps.push({ action: "create", kind: "textTabs", label: f.label, reason: "plain field, without the Smarty extension", tab: { ...want, documentId: "1", font: "arial", fontColor: "black", tabType: "text" } });
      } else if (found) {
        const changes = diff(found, want);
        if (Object.keys(changes).length > 0) {
          steps.push({ action: "update", kind: "textTabs", tabId: found.tabId, label: f.label, reason: found.tabLabel !== f.label ? `rename "${found.tabLabel}"` : "fit to the line", changes });
        }
      } else {
        steps.push({ action: "create", kind: "textTabs", label: f.label, reason: "new field", tab: { ...want, documentId: "1", font: "arial", fontColor: "black", tabType: "text" } });
      }
    } else if (f.kind === "checkbox") {
      const want = desiredBox(f);
      const legacy = Object.entries(LEGACY_RENAME).find(([, to]) => to === f.label)?.[0];
      const found =
        take(boxes.find((t) => t.tabLabel === f.label && !used.has(t.tabId!))) ??
        take(boxes.find((t) => legacy && t.tabLabel === legacy)) ??
        // The other financing boxes of line 23 had no name ("Checkbox <uuid>").
        take(f.label.startsWith("financing_") ? boxes.find((t) => /^Checkbox /.test(t.tabLabel ?? "") && !used.has(t.tabId!) && near(t, f.page, f.x, f.y, 9)) : undefined);
      if (found) {
        const changes = diff(found, want);
        if (Object.keys(changes).length > 0) {
          steps.push({ action: "update", kind: "checkboxTabs", tabId: found.tabId, label: f.label, reason: found.tabLabel !== f.label ? `rename "${found.tabLabel}"` : "over the printed box", changes });
        }
      } else {
        steps.push({ action: "create", kind: "checkboxTabs", label: f.label, reason: "new box", tab: { ...want, documentId: "1", tabType: "checkbox" } });
      }
    } else {
      steps.push(...planRadio(f, live));
    }
  }

  // Whatever is left with a label the site used to send, or that no longer belongs.
  for (const t of texts) {
    if (used.has(t.tabId!) || /^lixtara_footer_/.test(t.tabLabel ?? "")) continue;
    const why = LEGACY_DELETE[t.tabLabel ?? ""] ?? (t.tabLabel === "personal_property" ? "second personal property field (a box over lines 18–20): one field on line 17" : null);
    if (why) steps.push({ action: "delete", kind: "textTabs", tabId: t.tabId, label: t.tabLabel ?? "", reason: why });
  }
  for (const t of boxes) {
    if (used.has(t.tabId!)) continue;
    const why = LEGACY_DELETE[t.tabLabel ?? ""];
    if (why) steps.push({ action: "delete", kind: "checkboxTabs", tabId: t.tabId, label: t.tabLabel ?? "", reason: why });
  }
  for (const t of live.listTabs ?? []) {
    if (/extensibilityplatform\.action\.verify\.postaladdress/.test(t.tabLabel ?? "")) {
      steps.push({ action: "delete", kind: "listTabs", tabId: t.tabId, label: "Smarty country list", reason: 'Smarty address verification: a required "Country or Region" list over lines 13–14; the address comes from the site, already verified' });
    }
  }
  // Checkbox groups left without a box.
  const deletedBoxIds = new Set(steps.filter((s) => s.action === "delete" && s.kind === "checkboxTabs").map((s) => s.tabId));
  for (const g of live.tabGroups ?? []) {
    const members = boxes.filter((b) => ((b.tabGroupLabels as string[] | undefined) ?? []).includes(String(g.groupLabel)));
    if (members.length > 0 && members.every((b) => deletedBoxIds.has(b.tabId))) {
      steps.push({ action: "delete", kind: "tabGroups", tabId: g.tabId, label: String(g.groupLabel), reason: "its checkbox is deleted" });
    }
  }
  return steps;
}

function planRadio(f: RadioGroupField, live: LiveSellerTabs): PlanStep[] {
  const existing = (live.radioGroupTabs ?? []).find((g) => g.groupName === f.groupName);
  const want = {
    groupName: f.groupName,
    documentId: "1",
    tabType: "radioGroup",
    radios: f.radios.map((r) => ({
      pageNumber: String(f.page),
      xPosition: String(Math.round(r.x)),
      yPosition: String(Math.round(r.y)),
      value: r.value,
      required: String(f.required),
      locked: String(f.locked),
    })),
  };
  if (!existing) return [{ action: "create", kind: "radioGroupTabs", label: f.groupName, reason: `one choice: ${f.radios.map((r) => r.value).join(" / ")} (line ${f.line})`, tab: want }];
  const before = JSON.stringify((existing.radios ?? []).map((r) => [r.value, r.xPosition, r.yPosition, r.required, r.locked]));
  const after = JSON.stringify(want.radios.map((r) => [r.value, r.xPosition, r.yPosition, r.required, r.locked]));
  return before === after
    ? []
    : [{ action: "update", kind: "radioGroupTabs", tabId: existing.tabId, label: f.groupName, reason: "over the printed boxes", changes: { radios: [before, after] }, tab: want }];
}

/**
 * Initials of one role (Seller or Broker): one per page, moved into that party's blank of the
 * page footer (ERS21TN_INITIALS). Matched by page; a page without one gets it created.
 */
export function planInitialFixes(live: LiveSellerTabs, role: "Seller" | "Broker"): PlanStep[] {
  const steps: PlanStep[] = [];
  const tabs = live.initialHereTabs ?? [];
  for (const f of ERS21TN_INITIALS.filter((i) => i.role === role)) {
    const want = { pageNumber: String(f.page), xPosition: String(Math.round(f.x)), yPosition: String(Math.round(f.y)), scaleValue: String(f.scale) };
    const found = tabs.find((t) => num(t.pageNumber) === f.page);
    const label = `${role} initials p${f.page}`;
    if (!found) {
      steps.push({ action: "create", kind: "initialHereTabs", label, reason: "footer blank", tab: { ...want, documentId: "1", tabType: "initialHere", optional: "false" } });
      continue;
    }
    const changes: Record<string, [string, string]> = {};
    for (const [k, v] of Object.entries(want)) if (Number(fmt(found[k]) || NaN) !== Number(v)) changes[k] = [fmt(found[k]), v];
    if (Object.keys(changes).length > 0) steps.push({ action: "update", kind: "initialHereTabs", tabId: found.tabId, label, reason: `into the "${role === "Seller" ? "Seller" : "Broker/Authorized Associate"} (____)" blank of the footer`, changes });
  }
  return steps;
}

/**
 * The seller's signatures and dates on page 4 (ERS21TN_SELLER_SIGNATURES), matched by label: the
 * signature and date of page 6 have other labels and stay as they are.
 */
export function planSignatureFixes(live: LiveSellerTabs): PlanStep[] {
  const steps: PlanStep[] = [];
  for (const f of ERS21TN_SELLER_SIGNATURES) {
    const want: Record<string, string> = {
      tabLabel: f.label,
      pageNumber: String(f.page),
      xPosition: String(Math.round(f.x)),
      yPosition: String(Math.round(f.y)),
      ...(f.scale ? { scaleValue: String(f.scale) } : { fontSize: `size${ERS21TN_FONT_SIZE_PT}` }),
    };
    const found = (live[f.kind] ?? []).find((t) => t.tabLabel === f.label);
    const what = f.kind === "signHereTabs" ? "signature" : "date";
    if (!found) {
      steps.push({
        action: "create",
        kind: f.kind,
        label: f.label,
        reason: `seller's ${what}, line ${f.line}`,
        tab: { ...want, documentId: "1", tabType: f.kind === "signHereTabs" ? "signHere" : "dateSigned", ...(f.kind === "signHereTabs" ? { optional: "false" } : { font: "arial" }) },
      });
      continue;
    }
    const changes: Record<string, [string, string]> = {};
    for (const [k, v] of Object.entries(want)) {
      const before = fmt(found[k]);
      const same = k === "scaleValue" || k === "xPosition" || k === "yPosition" || k === "pageNumber" ? Number(before || NaN) === Number(v) : before.toLowerCase() === v.toLowerCase();
      if (!same) changes[k] = [before, v];
    }
    if (Object.keys(changes).length > 0) steps.push({ action: "update", kind: f.kind, tabId: found.tabId, label: f.label, reason: `seller's ${what}, line ${f.line}`, changes });
  }
  return steps;
}

/** The plan as a readable diff (what --dry-run prints and what the owner approves). */
export function formatPlan(steps: PlanStep[]): string {
  const lines: string[] = [];
  for (const s of steps) {
    const head = `${s.action === "create" ? "+" : s.action === "delete" ? "−" : "~"} ${s.kind.replace("Tabs", "")} ${s.label}  (${s.reason})`;
    lines.push(head);
    if (s.changes) for (const [k, [a, b]] of Object.entries(s.changes)) lines.push(`    ${k}: ${a === "" ? "∅" : a} → ${b === "" ? "∅" : b}`);
    if (s.action === "create" && s.tab) {
      const t = s.tab as Record<string, unknown>;
      if (t.radios) for (const r of t.radios as Array<Record<string, string>>) lines.push(`    radio ${r.value}: p${r.pageNumber} x${r.xPosition} y${r.yPosition} required=${r.required}`);
      else if (t.locked === undefined) lines.push(`    p${t.pageNumber} x${t.xPosition} y${t.yPosition}${t.scaleValue ? ` scale ${t.scaleValue}` : ""}`);
      else lines.push(`    p${t.pageNumber} x${t.xPosition} y${t.yPosition}${t.width ? ` w${t.width} h${t.height}` : ""} locked=${t.locked} required=${t.required}${t.conditionalParentLabel ? ` if ${t.conditionalParentLabel}=${t.conditionalParentValue}` : ""}`);
    }
  }
  const count = (a: PlanStep["action"]) => steps.filter((s) => s.action === a).length;
  lines.push("", `${count("update")} to update, ${count("create")} to create, ${count("delete")} to delete.`);
  return lines.join("\n");
}
