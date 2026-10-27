// Fixes the Listing Agreement template (ERS-21tn) through the DocuSign API, versioned in the
// repo: the plan is src/lib/docusign/template-fix-plan.ts, the positions
// src/lib/docusign/ers21tn-layout.ts, the field map docs/docusign/field-map-ers21tn.md.
//
//   pnpm tsx scripts/docusign/apply-template-fixes.ts                      → --dry-run: prints the diff, writes nothing
//   pnpm tsx scripts/docusign/apply-template-fixes.ts --apply --copy-as "Lixtara - Listing Agreement (ERS-21tn) v2"
//        → copies the template and fixes the COPY (the original stays as it is: rollback = keep its id)
//   pnpm tsx scripts/docusign/apply-template-fixes.ts --apply              → fixes the template in place
//
// Options: --template-id <id> (default DOCUSIGN_LISTING_AGREEMENT_TEMPLATE_ID); --anchors (also
// sets anchor strings; only if the template's PDF has a text layer: checked first).
// The account is the one in .env.local (DOCUSIGN_BASE_URI / DOCUSIGN_ACCOUNT_ID): the same
// script serves the production account once the licensed forms are there. The positions are the
// Demo form's: a different form version needs its layout measured again (or --anchors).
//
// Order with the code: the site sends the NEW labels (city_state_zip, financing_cash,
// buyer_comp_pct…). Fix a copy, test it, and switch DOCUSIGN_LISTING_AGREEMENT_TEMPLATE_ID to
// the copy in the same deploy that ships the code.
import "./env";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAccessToken } from "../../src/lib/docusign";
import { ERS21TN_BROKER_SIGNATURES, ERS21TN_FIELDS } from "../../src/lib/docusign/ers21tn-layout";
import { formatPlan, planInitialFixes, planSignatureFixes, planTemplateFixes, type LiveSellerTabs, type PlanStep } from "../../src/lib/docusign/template-fix-plan";
import { apiBase, dsGet } from "./dump-templates";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes("--apply");
const ANCHORS = process.argv.includes("--anchors");
const COPY_AS = arg("--copy-as");
const SELLER_ROLE = "Seller";
const BROKER_ROLE = "Broker";

async function ds(method: "POST" | "PUT" | "DELETE", path: string, body: unknown): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`DocuSign ${method} ${path} ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : null;
}

type Recipient = { recipientId: string; roleName?: string; routingOrder?: string; tabs?: LiveSellerTabs & Record<string, unknown[]> };

async function recipientOf(templateId: string, role: string): Promise<Recipient> {
  const r = (await (await dsGet(`/templates/${templateId}/recipients?include_tabs=true&include_extended=true`)).json()) as { signers?: Recipient[] };
  const signer = (r.signers ?? []).find((s) => s.roleName === role);
  if (!signer) throw new Error(`template ${templateId} has no "${role}" role`);
  return signer;
}

/** Seller: every field the site fills, the seller's initials and page-4 signatures; Broker: the broker's initials and the L257 date. */
async function planFor(templateId: string, role: string): Promise<{ recipientId: string; steps: PlanStep[] }> {
  const r = await recipientOf(templateId, role);
  const tabs = r.tabs ?? {};
  const steps =
    role === SELLER_ROLE
      ? [...planTemplateFixes(tabs, { anchors: ANCHORS }), ...planInitialFixes(tabs, "Seller"), ...planSignatureFixes(tabs)]
      : [...planInitialFixes(tabs, "Broker"), ...planSignatureFixes(tabs, ERS21TN_BROKER_SIGNATURES, "broker")];
  return { recipientId: r.recipientId, steps };
}

/** Each anchor must appear in the PDF's text exactly once, or DocuSign would misplace the tab. */
async function checkAnchors(templateId: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "ds-anchors-"));
  const pdf = join(dir, "t.pdf");
  writeFileSync(pdf, Buffer.from(await (await dsGet(`/templates/${templateId}/documents/combined`, "application/pdf")).arrayBuffer()));
  const text = execFileSync("pdftotext", [pdf, "-"]).toString().replace(/\s+/g, " ");
  const bad = ERS21TN_FIELDS.flatMap((f) => (f.kind === "text" && f.anchor ? [f.anchor] : [])).filter((a) => text.split(a).length - 1 !== 1);
  if (text.trim().length < 50) throw new Error("--anchors: the template's PDF has no text layer (scanned image); use coordinates");
  if (bad.length) throw new Error(`--anchors: not found exactly once in the PDF: ${bad.map((a) => `"${a}"`).join(", ")}`);
}

// Read-only properties DocuSign returns but doesn't accept back on a new template.
const READ_ONLY = new Set(["tabId", "templateLocked", "templateRequired", "source", "tabFullyQualifiedPath", "agreementAttributeLocked", "localePolicy", "recipientIdGuid"]);
const clean = (t: Record<string, unknown>) => Object.fromEntries(Object.entries(t).filter(([k]) => !READ_ONLY.has(k)));

/** New template with the same PDF, roles and tabs (minus extension tabs). Returns its id. */
async function copyTemplate(templateId: string, name: string): Promise<string> {
  const tpl = (await (await dsGet(`/templates/${templateId}?include=documents`)).json()) as Record<string, unknown>;
  const doc = ((tpl.documents as Array<Record<string, string>>) ?? [])[0];
  const pdf = Buffer.from(await (await dsGet(`/templates/${templateId}/documents/${doc.documentId}`, "application/pdf")).arrayBuffer());
  const r = (await (await dsGet(`/templates/${templateId}/recipients?include_tabs=true`)).json()) as { signers?: Recipient[] };
  const signers = (r.signers ?? []).map((s) => {
    const tabs: Record<string, unknown[]> = {};
    for (const [kind, arr] of Object.entries(s.tabs ?? {})) {
      const kept = (arr as Array<Record<string, unknown>>).filter((t) => !t.extensionData).map(clean);
      if (kept.length) tabs[kind] = kept;
    }
    return { recipientId: s.recipientId, roleName: s.roleName, routingOrder: s.routingOrder, tabs };
  });
  const created = (await ds("POST", "/templates", {
    name,
    description: `Copy of ${templateId} with scripts/docusign/apply-template-fixes.ts`,
    emailSubject: tpl.emailSubject,
    emailBlurb: tpl.emailBlurb,
    documents: [{ documentId: doc.documentId, name: doc.name, documentBase64: pdf.toString("base64") }],
    recipients: { signers },
  })) as { templateId: string };
  return created.templateId;
}

async function apply(templateId: string, recipientId: string, steps: PlanStep[]): Promise<void> {
  const path = `/templates/${templateId}/recipients/${recipientId}/tabs`;
  const group = (action: PlanStep["action"], f: (s: PlanStep) => Record<string, unknown>) => {
    const body: Record<string, unknown[]> = {};
    for (const s of steps.filter((x) => x.action === action)) (body[s.kind] ??= []).push(f(s));
    return body;
  };
  const deletes = group("delete", (s) => ({ tabId: s.tabId }));
  const updates = group("update", (s) =>
    s.kind === "radioGroupTabs" ? { tabId: s.tabId, ...s.tab } : { tabId: s.tabId, ...Object.fromEntries(Object.entries(s.changes ?? {}).map(([k, [, v]]) => [k, v])) },
  );
  const creates = group("create", (s) => ({ ...s.tab, recipientId }));
  if (Object.keys(deletes).length) await ds("DELETE", path, deletes);
  if (Object.keys(updates).length) await ds("PUT", path, updates);
  if (Object.keys(creates).length) await ds("POST", path, creates);
}

async function main() {
  let templateId = arg("--template-id") ?? process.env.DOCUSIGN_LISTING_AGREEMENT_TEMPLATE_ID;
  if (!templateId) throw new Error("no template: --template-id or DOCUSIGN_LISTING_AGREEMENT_TEMPLATE_ID");
  const host = new URL(process.env.DOCUSIGN_BASE_URI ?? "https://?").hostname;
  console.log(`${APPLY ? "APPLY" : "DRY RUN (nothing is written)"} · ${host} · template ${templateId}${COPY_AS ? ` → copy "${COPY_AS}"` : ""}${ANCHORS ? " · anchors" : ""}\n`);
  if (ANCHORS) await checkAnchors(templateId);

  if (APPLY && COPY_AS) {
    templateId = await copyTemplate(templateId, COPY_AS);
    console.log(`Copy created: ${templateId}\n`);
  }
  let pending = 0;
  for (const role of [SELLER_ROLE, BROKER_ROLE]) {
    const { recipientId, steps } = await planFor(templateId, role);
    console.log(`── ${role} ──\n${formatPlan(steps)}\n`);
    if (!APPLY || steps.length === 0) continue;

    await apply(templateId, recipientId, steps);
    let left = (await planFor(templateId, role)).steps;
    // A condition on a tab created or renamed in the same call (occupancy, financing_other) is
    // dropped by DocuSign: a second pass sets it once the parent exists (seen on 2026-10-21).
    if (left.length > 0 && left.every((s) => s.action === "update")) {
      await apply(templateId, recipientId, left);
      left = (await planFor(templateId, role)).steps;
    }
    if (left.length > 0) console.log(`✗ ${role}: still different after applying:\n${formatPlan(left)}\n`);
    pending += left.length;
  }
  if (!APPLY) return console.log("Nothing was written. To apply: --apply (--copy-as \"<name>\" to fix a copy).");
  console.log(pending === 0 ? `✓ Applied. The template now matches the layout (template ${templateId}).` : "✗ Some changes didn't apply (above).");
  if (pending > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
