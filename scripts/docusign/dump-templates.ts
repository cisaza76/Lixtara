// Read-only: saves each DocuSign template (definition with every tab, plus its PDF) to a
// local folder, for the field map (docs/docusign/field-map-*.md) and for apply-template-fixes.
//
//   pnpm tsx scripts/docusign/dump-templates.ts [--out <dir>]
//
// Default folder: docs/docusign/live-<account host>-<date>/ (docs/docusign is gitignored:
// the exports carry the forms' licensed text).
import "./env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAccessToken } from "../../src/lib/docusign";

export const TEMPLATE_ENVS = [
  { key: "ERS-21tn", env: "DOCUSIGN_LISTING_AGREEMENT_TEMPLATE_ID" },
  { key: "CASSB-1", env: "DOCUSIGN_COMPENSATION_AGREEMENT_TEMPLATE_ID" },
  { key: "AS-IS", env: "DOCUSIGN_AS_IS_CONTRACT_TEMPLATE_ID" },
  { key: "CA-8", env: "DOCUSIGN_COMMISSION_AGREEMENT_TEMPLATE_ID" },
] as const;

export function apiBase(): string {
  return `${process.env.DOCUSIGN_BASE_URI}/restapi/v2.1/accounts/${process.env.DOCUSIGN_ACCOUNT_ID}`;
}

export async function dsGet(path: string, accept = "application/json"): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${apiBase()}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: accept } });
  if (!res.ok) throw new Error(`DocuSign GET ${path} ${res.status}: ${await res.text()}`);
  return res;
}

async function main() {
  const outIdx = process.argv.indexOf("--out");
  const host = new URL(process.env.DOCUSIGN_BASE_URI ?? "https://unknown").hostname.split(".")[0];
  const out = outIdx > 0 ? process.argv[outIdx + 1] : join("docs/docusign", `live-${host}-${new Date().toISOString().slice(0, 10)}`);
  mkdirSync(out, { recursive: true });
  for (const t of TEMPLATE_ENVS) {
    const id = process.env[t.env];
    if (!id) {
      console.log(`✗ ${t.key}: ${t.env} not set`);
      continue;
    }
    const tpl = await (await dsGet(`/templates/${id}?include=recipients,tabs,documents`)).json();
    // recipients?include_tabs gives every tab with its full set of properties.
    const recipients = await (await dsGet(`/templates/${id}/recipients?include_tabs=true&include_extended=true`)).json();
    writeFileSync(join(out, `${t.key}.json`), JSON.stringify({ templateId: id, name: tpl.name, documents: tpl.documents, recipients }, null, 2));
    const pdf = Buffer.from(await (await dsGet(`/templates/${id}/documents/combined`, "application/pdf")).arrayBuffer());
    writeFileSync(join(out, `${t.key}.pdf`), pdf);
    console.log(`✓ ${t.key}: "${tpl.name}" → ${out}/${t.key}.json, .pdf (${(pdf.length / 1024).toFixed(0)} KB)`);
  }
}

if (process.argv[1]?.endsWith("dump-templates.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
