// Three TEST listing-agreement envelopes with made-up data, through the SAME code as the site
// (listingAgreementTabs + createEnvelopeFromTemplate), to review a template's PDFs before using
// it. No database: the listings are fixtures marked TEST. The signers are made up
// (@example.com, the seller embedded), so no real person gets an email; each envelope is
// voided once its PDF is saved (--keep leaves them open).
//
//   pnpm tsx scripts/docusign/test-envelopes.ts --template-id <id> [--out <dir>] [--keep]
//   … --sign-urls        → creates them and prints the TEST seller's signing link (Demo) for each
//   … --download <ids>   → after signing: saves each PDF and voids the envelope
//   … --only <key>       → just one of the cases (e.g. b-no-tenant-other)
//
// DocuSign prints the values the site filled in only once the signer finished: an envelope
// that was just sent downloads as the blank form (seen on 2026-10-21). To review values, sign
// each one as the TEST seller (--sign-urls), then --download.
//
// One plan each, so the cancellation fee (line 207) shows all three flat fees:
// (a) Essentials; tenant + lease end date, financing Cash + Conventional; buyer's broker 2.5% → 10(b)
// (b) Pro; vacant (→ lock box), financing Other with text; buyer's broker $12,000 → 10(b)
// (c) Concierge (→ lock box); owner-occupied, VA + FHA, legal description not verified →
//     "See Attachment" + attachment; buyer's broker 0% → 10(c)
import "./env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEnvelopeFromTemplate, getAccessToken, getRecipientView, LIXTARA_BROKER_ROLE } from "../../src/lib/docusign";
import { attachmentHtml, listingAgreementTabs, type AgreementListing } from "../../src/lib/docusign/listing-agreement-tabs";
import type { BuyerCompOffer } from "../../src/lib/buyer-comp";
import { PRICING_TIERS, type PricingTierId } from "../../src/lib/pricing-tiers";
import { t } from "../../src/lib/i18n";
import { apiBase, dsGet } from "./dump-templates";

const arg = (n: string) => (process.argv.indexOf(n) > 0 ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const templateId = arg("--template-id");
if (!templateId) throw new Error("--template-id <id>");
const out = arg("--out") ?? "docs/docusign/test-envelopes";
const KEEP = process.argv.includes("--keep");

const base: AgreementListing = {
  address_street: "123 TEST Street, Unit 4",
  address_city: "Miami",
  address_state: "FL",
  address_zip: "33131",
  folio: "0000000000000",
  list_price: 650000,
  cash_only: false,
  financing_terms: ["cash"],
  financing_other: null,
  occupancy_status: "vacant",
  lease_end_date: null,
  appliances: ["refrigerator", "range_oven", "dishwasher"],
  pricing_tier: "pro",
};
const VERIFIED = "TEST SUBDIVISION PB 00-00\nLOT 4 BLK 1 (TEST DATA)";

const CASES: Array<{ key: string; tier: PricingTierId; listing: AgreementListing; verifiedLegal: string | null; buyerOffer: BuyerCompOffer }> = [
  {
    key: "a-tenant-cash-conventional",
    tier: "essentials",
    listing: { ...base, pricing_tier: "essentials", occupancy_status: "tenant_occupied", lease_end_date: "2027-03-31", financing_terms: ["cash", "conventional"] },
    verifiedLegal: VERIFIED,
    buyerOffer: { type: "percent", pct: 2.5 },
  },
  {
    key: "b-no-tenant-other",
    tier: "pro",
    listing: { ...base, occupancy_status: "vacant", financing_terms: ["other"], financing_other: "TEST: seller financing with 20% down" },
    verifiedLegal: VERIFIED,
    buyerOffer: { type: "amount", amount: 12000 },
  },
  {
    key: "c-legal-pending",
    tier: "concierge",
    listing: { ...base, pricing_tier: "concierge", occupancy_status: "owner_occupied", financing_terms: ["va", "fha"] },
    verifiedLegal: null,
    buyerOffer: { type: "none" },
  },
];

async function voidEnvelope(id: string) {
  const token = await getAccessToken();
  const res = await fetch(`${apiBase()}/envelopes/${id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "voided", voidedReason: "TEST envelope (template review)" }),
  });
  if (!res.ok) console.error(`  ✗ void ${id}: ${res.status} ${await res.text()}`);
}

const SELLER = { email: "test-seller@example.com", name: "TEST Seller (made-up data)" };

async function download(ids: string[]) {
  mkdirSync(out, { recursive: true });
  for (const [i, envelopeId] of ids.entries()) {
    const pdf = Buffer.from(await (await dsGet(`/envelopes/${envelopeId}/documents/combined`, "application/pdf")).arrayBuffer());
    const file = join(out, `ers21tn-test-${arg("--only") ?? CASES[i]?.key ?? envelopeId}.pdf`);
    writeFileSync(file, pdf);
    console.log(`✓ ${envelopeId} → ${file}`);
    if (!KEEP) await voidEnvelope(envelopeId);
  }
}

async function main() {
  const dl = arg("--download");
  if (dl) return download(dl.split(","));
  const signUrls = process.argv.includes("--sign-urls");
  mkdirSync(out, { recursive: true });
  const applianceLabels = t("en").listingForm.step3.appliances as Record<string, string>;
  const only = arg("--only");
  for (const c of CASES.filter((x) => !only || x.key === only)) {
    const contract = listingAgreementTabs({
      listing: c.listing,
      tier: PRICING_TIERS[c.tier],
      sellerName: "TEST Seller (made-up data)",
      // Made-up contact for lines 247–249 (case c: no phone → line 247 blank).
      seller: { phone: c.key.startsWith("c-") ? null : "305-555-0100", email: SELLER.email },
      brokerName: "Lixtara LLC",
      buyerOffer: c.buyerOffer,
      verifiedLegal: c.verifiedLegal,
      applianceLabels,
      today: new Date(),
    });
    const { envelopeId } = await createEnvelopeFromTemplate({
      templateId: templateId!,
      signerRole: "Seller",
      signerEmail: SELLER.email,
      signerName: SELLER.name,
      clientUserId: `test-${c.key}`,
      brokerSigner: { roleName: LIXTARA_BROKER_ROLE.listingAgreement, name: "TEST Broker", email: "test-broker@example.com" },
      textTabs: contract.text,
      lockedTextTabs: contract.lockedText,
      checkboxTabs: contract.checkbox,
      lockedCheckboxTabs: contract.lockedCheckbox,
      radioGroupTabs: contract.radio,
      attachments: contract.attachment.length
        ? [{ name: "Attachment to Listing Agreement", html: attachmentHtml(contract.attachment, `${c.listing.address_street}, ${contract.text.city_state_zip}`) }]
        : undefined,
      emailSubject: `TEST — listing agreement template review (${c.key})`,
    });
    if (signUrls) {
      const view = await getRecipientView({ envelopeId, signerEmail: SELLER.email, signerName: SELLER.name, clientUserId: `test-${c.key}`, returnUrl: "https://example.com/signed" });
      console.log(`${c.key}\t${envelopeId}\t${view.url}`);
      continue;
    }
    const pdf = Buffer.from(await (await dsGet(`/envelopes/${envelopeId}/documents/combined`, "application/pdf")).arrayBuffer());
    const file = join(out, `ers21tn-test-${c.key}.pdf`);
    writeFileSync(file, pdf);
    console.log(`✓ ${c.key}: envelope ${envelopeId} → ${file} (legal ${contract.legalStatus}, attachment: ${contract.attachment.length ? "yes" : "no"})`);
    if (!KEEP) await voidEnvelope(envelopeId);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
