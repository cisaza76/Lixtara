// One-shot: list the text-tab labels defined on the Lixtara listing-agreement
// template so we can verify they match what /api/agreement/create sends.
//
// Run:  pnpm tsx scripts/check-docusign-template.ts

// Minimal .env.local loader that supports multi-line quoted values (needed
// for DOCUSIGN_PRIVATE_KEY which spans 27 lines in PEM format).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
try {
  const envText = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const lines = envText.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i += 1;
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      i += 1;
      continue;
    }
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1);

    if (v.startsWith('"')) {
      // Multi-line quoted value: keep absorbing lines until the closing quote.
      v = v.slice(1);
      const parts: string[] = [];
      if (v.endsWith('"') && v.length > 0 && !v.endsWith('\\"')) {
        parts.push(v.slice(0, -1));
        i += 1;
      } else {
        parts.push(v);
        i += 1;
        while (i < lines.length) {
          const next = lines[i];
          if (next.endsWith('"')) {
            parts.push(next.slice(0, -1));
            i += 1;
            break;
          }
          parts.push(next);
          i += 1;
        }
      }
      // The docusign wrapper expects literal "\n" sequences; convert real
      // newlines to "\n" so its existing replace() does the right thing.
      const joined = parts.join("\n").replace(/\n/g, "\\n");
      if (!process.env[k]) process.env[k] = joined;
    } else {
      // Single-line, optionally single-quoted.
      let val = v.trim();
      if (val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = val;
      i += 1;
    }
  }
} catch {
  // .env.local optional — vars may come from the shell.
}

import { getAccessToken } from "../src/lib/docusign";

// The labels POST /api/agreement/create currently sends. Order matches the
// route handler so the diff at the bottom is easy to scan.
const SENT_LABELS = [
  // identity
  "street_address",
  "city",
  "state",
  "zip",
  "folio",
  "legal_description",
  "property_type",
  // characteristics
  "bedrooms",
  "bathrooms",
  "sqft",
  "lot_size",
  "year_built",
  "parking_spaces",
  "pool",
  "flood_zone",
  "property_description",
  // financial
  "list_price",
  "hoa_fee",
  "tax_annual",
  "cash_only",
  // occupancy / tenancy
  "occupancy_status",
  "monthly_rent",
  "lease_end_date",
  "tenant_cooperation",
  // personal property (appliances)
  "personal_property",
  // checkbox tabs (template must bind on the Seller role):
  //   lockbox_authorized → line 71-E · buyer_commission_ack → line 145-A
  "lockbox_authorized",
  "buyer_commission_ack",
  // parties
  "seller_name",
  "broker_name",
  // economics
  "flat_fee",
  "commission_pct",
  "buyer_agent_commission",
  // term
  "start_date",
  "termination_date",
];

interface Tab {
  tabLabel?: string;
  tabType?: string;
  name?: string;
  recipientId?: string;
  documentId?: string;
}

interface TabsResponse {
  textTabs?: Tab[];
  numberTabs?: Tab[];
  checkboxTabs?: Tab[];
  dateTabs?: Tab[];
  dateSignedTabs?: Tab[];
  signHereTabs?: Tab[];
  initialHereTabs?: Tab[];
  fullNameTabs?: Tab[];
  emailTabs?: Tab[];
  ssnTabs?: Tab[];
  zipTabs?: Tab[];
  noteTabs?: Tab[];
  listTabs?: Tab[];
  radioGroupTabs?: { groupName?: string; radios?: Tab[] }[];
  formulaTabs?: Tab[];
  titleTabs?: Tab[];
  companyTabs?: Tab[];
  approveTabs?: Tab[];
  declineTabs?: Tab[];
}

interface Recipient {
  recipientId: string;
  roleName?: string;
  name?: string;
  email?: string;
  tabs?: TabsResponse;
}

interface RecipientsResponse {
  signers?: Recipient[];
  agents?: Recipient[];
  carbonCopies?: Recipient[];
  certifiedDeliveries?: Recipient[];
  inPersonSigners?: Recipient[];
  intermediaries?: Recipient[];
  editors?: Recipient[];
}

async function main() {
  const templateId = process.env.DOCUSIGN_LISTING_AGREEMENT_TEMPLATE_ID;
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const baseUri = process.env.DOCUSIGN_BASE_URI;
  if (!templateId || !accountId || !baseUri) {
    throw new Error(
      "Missing DOCUSIGN_LISTING_AGREEMENT_TEMPLATE_ID / DOCUSIGN_ACCOUNT_ID / DOCUSIGN_BASE_URI",
    );
  }

  const token = await getAccessToken();

  const url = `${baseUri}/restapi/v2.1/accounts/${accountId}/templates/${templateId}/recipients?include_tabs=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DocuSign template fetch failed: ${res.status} ${txt}`);
  }
  const data = (await res.json()) as RecipientsResponse;

  console.log("\n=== Template recipients ===");
  const allRecipients: Recipient[] = [
    ...(data.signers ?? []),
    ...(data.agents ?? []),
    ...(data.inPersonSigners ?? []),
  ];

  if (allRecipients.length === 0) {
    console.log("(no signers defined on this template)");
    return;
  }

  const collectedTabLabels = new Set<string>();
  const tabTypeByLabel = new Map<string, string>();

  for (const r of allRecipients) {
    console.log(
      `\n• role="${r.roleName ?? "(unnamed)"}"  recipientId=${r.recipientId}`,
    );
    const tabs = r.tabs ?? {};
    const tabBuckets: Array<[string, Tab[] | undefined]> = [
      ["text", tabs.textTabs],
      ["number", tabs.numberTabs],
      ["checkbox", tabs.checkboxTabs],
      ["date", tabs.dateTabs],
      ["dateSigned", tabs.dateSignedTabs],
      ["signHere", tabs.signHereTabs],
      ["initialHere", tabs.initialHereTabs],
      ["fullName", tabs.fullNameTabs],
      ["email", tabs.emailTabs],
      ["ssn", tabs.ssnTabs],
      ["zip", tabs.zipTabs],
      ["note", tabs.noteTabs],
      ["list", tabs.listTabs],
      ["formula", tabs.formulaTabs],
      ["title", tabs.titleTabs],
      ["company", tabs.companyTabs],
    ];
    for (const [kind, arr] of tabBuckets) {
      if (!arr || arr.length === 0) continue;
      for (const t of arr) {
        const label = t.tabLabel ?? "(no label)";
        collectedTabLabels.add(label);
        if (!tabTypeByLabel.has(label)) tabTypeByLabel.set(label, kind);
        console.log(`    [${kind}] tabLabel="${label}"`);
      }
    }
    if (tabs.radioGroupTabs && tabs.radioGroupTabs.length > 0) {
      for (const rg of tabs.radioGroupTabs) {
        const label = rg.groupName ?? "(no groupName)";
        collectedTabLabels.add(label);
        if (!tabTypeByLabel.has(label)) tabTypeByLabel.set(label, "radioGroup");
        console.log(`    [radioGroup] groupName="${label}"`);
      }
    }
  }

  console.log("\n=== Coverage vs route handler ===");
  console.log(
    `(we send ${SENT_LABELS.length} labels; template has ${collectedTabLabels.size} tabs total)\n`,
  );
  console.log("Label                            | Status         | Type");
  console.log("---------------------------------+----------------+------------");
  for (const label of SENT_LABELS) {
    const has = collectedTabLabels.has(label);
    const type = tabTypeByLabel.get(label) ?? "";
    console.log(
      `${label.padEnd(32)} | ${has ? "✓ in template " : "✗ MISSING     "} | ${type}`,
    );
  }

  const extra = [...collectedTabLabels].filter(
    (l) => !SENT_LABELS.includes(l) && l !== "(no label)",
  );
  if (extra.length > 0) {
    console.log(
      `\n=== Tabs on template that we DON'T currently send (${extra.length}) ===`,
    );
    for (const l of extra) {
      console.log(`  - "${l}"  [${tabTypeByLabel.get(l) ?? "?"}]`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
