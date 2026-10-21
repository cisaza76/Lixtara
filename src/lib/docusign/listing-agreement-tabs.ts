// What Lixtara writes on the Listing Agreement (ERS-21tn) for one listing. Pure: no DocuSign,
// no database. POST /api/agreement/create sends the result; the template binds each label
// (positions and capacity per line: ers21tn-layout.ts). Field map: docs/docusign/field-map-ers21tn.md.
//
// Rules (owner, 2026-10-21):
//   - nothing the form already prints is repeated in the value ("$", "%");
//   - the legal description comes only from the county, verified at signing time; when there
//     is none, or it doesn't fit on lines 15–16, the lines stay empty, "See Attachment" is
//     checked and the attachment carries it;
//   - personal property: one line; if the list doesn't fit, "See Attachment" + the attachment;
//   - occupancy: one choice (is / is not) from step 3; lease expiry only with "is", MM/DD/YYYY;
//   - financing (line 23): the boxes and "Other (specify)" come from step 3, read-only;
//   - buyer's broker (paragraph 10): the seller pays it apart from Lixtara's commission → 10(b)
//     with the % or amount on line 150; 0% → 10(c); never 10(a). One choice, read-only;
//   - the brokerage on lines 159, 171 (the second one) and 254–256: name, address, phone. The
//     broker signs and dates line 254 herself.
//
// Broker's decisions (Anamaria, 2026-10-21):
//   - protection period (line 123) and retained deposits (line 128) from
//     src/config/listing-agreement.ts;
//   - two charges: the flat fee at checkout and the 8(a) % only if a sale closes. Line 110's
//     "plus $" and line 207's cancellation fee stay empty and read-only;
//   - paragraph 15 (lines 230–244): additionalTerms(), which controls over the printed clauses.

import { APPLIANCE_KEYS, sanitizeAppliances } from "@/lib/appliances";
import type { BuyerCompOffer } from "@/lib/buyer-comp";
import { buyerCompOption } from "@/lib/buyer-comp";
import { BROKERAGE } from "@/config/brokerage";
import { CONTACT } from "@/config/contact";
import { PROTECTION_NOTICE_DAYS, PROTECTION_PERIOD_DAYS, RETAINED_DEPOSITS_PCT } from "@/config/listing-agreement";
import type { PricingTier } from "@/lib/pricing-tiers";
import { savedFinancing } from "@/lib/financing-terms";
import { fitsOnLine, textWidthPt, textField } from "./ers21tn-layout";

export interface AgreementListing {
  address_street: string;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  folio: string | null;
  list_price: number;
  cash_only: boolean | null;
  /** Step 3, migration 20261021120000. Null on listings saved before it (then: cash_only). */
  financing_terms?: string[] | null;
  financing_other?: string | null;
  occupancy_status: "vacant" | "owner_occupied" | "tenant_occupied" | string | null;
  lease_end_date: string | null;
  appliances: string[] | null;
  pricing_tier: string | null;
}

export interface AgreementInput {
  listing: AgreementListing;
  tier: PricingTier;
  sellerName: string;
  brokerName: string;
  buyerOffer: BuyerCompOffer;
  /** From verifiedLegalDescription(): null when it couldn't be verified. */
  verifiedLegal: string | null;
  /** Canonical English appliance names (the contract is in English). */
  applianceLabels: Record<string, string>;
  today: Date;
}

export interface AttachmentSection {
  heading: string;
  body: string;
}

export interface AgreementTabs {
  text: Record<string, string>;
  /** Text labels the seller can't edit (the site set them). */
  lockedText: string[];
  checkbox: Record<string, boolean>;
  lockedCheckbox: string[];
  /** groupName → selected value, or null to let the seller choose. */
  radio: Record<string, { value: string | null; locked: boolean; options: string[] }>;
  /** Sections of the "Attachment to the Listing Agreement" document, if any. */
  attachment: AttachmentSection[];
  /** "pending" = no county-verified legal description: the admin can't approve (#217). */
  legalStatus: "verified" | "pending";
}

const LONG_DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" };

/** "2026-12-31" → "12/31/2026" (the lease date the form expects). Anything else → "". */
export function usDate(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

/** 650000 → "650,000"; 2.5 → "2.5" (the form prints the "$" or "%" itself). */
const plainNumber = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Paragraph 15, Additional Terms (owner and broker, 2026-10-21): the two-charge model. The flat
 * fee at checkout (refunded unless published), the 8(a) % only if a sale closes, termination at
 * any time at no charge, a narrow protection period. Read-only on lines 230–244; the Terms of
 * Service §6 and §16 say the same. Lawyer review pending (docs/legal, memo v3).
 */
export function additionalTermsClauses(tier: PricingTier): string[] {
  return [
    `(1) Flat Fee. Seller pays Broker a flat fee of $${plainNumber(tier.flatFee)} at checkout, before publication. It is earned and non-refundable upon first publication of the Property on the MLS, whether or not the Property sells. Seller receives a full refund if Broker does not approve the listing or the Property is not published on the MLS for any other reason.`,
    `(2) Commission. The Paragraph 8(a) percentage is due only if a sale of the Property closes; the sentence "closing is not a prerequisite for Broker's fee being earned" and Paragraph 8(d)(2) do not apply.`,
    "(3) Termination. Seller may terminate this Agreement at any time by written notice to Broker. Paragraph 12 does not apply, and no cancellation fee, expense reimbursement or other amount is due.",
    `(4) Protection Period. Paragraph 8(d)(3) applies only to buyers who toured the Property or made a written offer during this Agreement and whose names Broker delivers to Seller in writing within ${PROTECTION_NOTICE_DAYS} days after termination.`,
    "(5) This Paragraph 15 controls over any conflicting provision of this Agreement and over Lixtara's Terms of Service.",
  ];
}

/**
 * Lays the clauses over the lines `labels`, each clause starting on a new line. null when they
 * don't all fit.
 */
export function clausesOverLabels(clauses: string[], labels: string[]): string[] | null {
  const out: string[] = [];
  for (const clause of clauses) {
    const rest = labels.slice(out.length);
    let lines: string[] | null = null;
    for (let k = 1; k <= rest.length && !lines; k++) lines = splitOverLabels(clause, rest.slice(0, k));
    if (!lines) return null;
    out.push(...lines);
  }
  return [...out, ...labels.slice(out.length).map(() => "")];
}
export const ADDITIONAL_TERMS_LABELS = Array.from({ length: 15 }, (_, i) => `additional_terms_${i + 1}`);

/**
 * Splits `text` over the lines `labels`, in order, word by word. null when it doesn't fit in
 * all of them: the caller then uses the attachment.
 */
export function splitOverLabels(text: string, labels: string[]): string[] | null {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const out: string[] = [];
  let i = 0;
  for (const label of labels) {
    const room = textField(label).width - 2;
    let line = "";
    for (; i < words.length; i++) {
      const next = line ? `${line} ${words[i]}` : words[i];
      if (textWidthPt(next) > room) break;
      line = next;
    }
    // A word longer than the whole line never fits.
    if (!line && i < words.length) return null;
    out.push(line);
  }
  return i === words.length ? out : null;
}

/**
 * Splits `text` over two lines (labels `first`, `second`) word by word. null when it doesn't fit
 * in both: the caller then uses the attachment.
 */
export function splitOverLines(text: string, first: string, second: string): [string, string] | null {
  return splitOverLabels(text, [first, second]) as [string, string] | null;
}

export function listingAgreementTabs(input: AgreementInput): AgreementTabs {
  const { listing: p, tier, buyerOffer } = input;
  const attachment: AttachmentSection[] = [];

  const termination = new Date(input.today);
  termination.setMonth(termination.getMonth() + (tier.termMonths ?? 24));

  // Line 15–16: legal description, only verified, only if it fits.
  const legalOneLine = (input.verifiedLegal ?? "").replace(/\s*\n\s*/g, "; ").trim();
  const legalLines = legalOneLine ? splitOverLines(legalOneLine, "legal_description", "legal_description_2") : null;
  if (!legalLines) {
    // Owner, 2026-10-21: folio, full address and county, plus the description (or the note
    // that the broker provides it). Only Miami-Dade parcels are verified today.
    const fullAddress = [p.address_street, p.address_city, [p.address_state, p.address_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const verified = input.verifiedLegal?.trim() || null;
    attachment.push({
      heading: "Legal Description (line 15)",
      body: [
        `Folio (Parcel ID): ${p.folio?.trim() || "Not available"}`,
        `Property address: ${fullAddress}`,
        `County: ${verified ? "Miami-Dade" : "To be confirmed by Broker from the county property record"}`,
        "",
        verified ?? "To be provided by Broker from the official county property record for the Property described in line 13.",
      ].join("\n"),
    });
  }

  // Line 17: personal property, one line.
  const included = sanitizeAppliances(p.appliances ?? []);
  const items = APPLIANCE_KEYS.filter((k) => included.includes(k)).map((k) => input.applianceLabels[k]);
  const personal = items.length > 0 ? items.join(", ") : "None";
  const personalFits = fitsOnLine("personal_property", personal);
  if (!personalFits) attachment.push({ heading: "Personal Property, including appliances (line 17)", body: items.join("\n") });

  // Line 20: occupancy from step 3; the lease date only with "is".
  const occupancy =
    p.occupancy_status === "tenant_occupied" ? "is" : p.occupancy_status === "vacant" || p.occupancy_status === "owner_occupied" ? "is_not" : null;

  // Line 23: financing from step 3.
  const financing = new Set(savedFinancing(p));
  const otherText = financing.has("other") ? (p.financing_other ?? "").trim() : "";
  // Line 23 holds ~26 characters after "Other (specify)"; step 3 allows 120. Longer → the line
  // says "See Attachment" and the attachment has the full text (seen on a test envelope, 2026-10-21).
  const otherFits = !otherText || fitsOnLine("financing_other_specify", otherText);
  if (!otherFits) attachment.push({ heading: "Financing Terms, Other (line 23)", body: otherText });

  // Lockbox: Concierge always; Pro when the home is vacant. Essentials buys it as an add-on.
  const lockbox = tier.id === "concierge" || (tier.id === "pro" && p.occupancy_status === "vacant");

  // Paragraph 15: a fixed text, checked to fit by the tests; never in the attachment.
  const additional = clausesOverLabels(additionalTermsClauses(tier), ADDITIONAL_TERMS_LABELS);
  if (!additional) throw new Error("paragraph 15 doesn't fit on lines 230–244");

  const text: Record<string, string> = {
    seller_name: input.sellerName,
    broker_name: input.brokerName,
    start_date: input.today.toLocaleDateString("en-US", LONG_DATE),
    termination_date: termination.toLocaleDateString("en-US", LONG_DATE),
    street_address: p.address_street,
    city_state_zip: [p.address_city, [p.address_state, p.address_zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    legal_description: legalLines?.[0] ?? "",
    legal_description_2: legalLines?.[1] ?? "",
    personal_property: personalFits ? personal : "",
    lease_end_date: occupancy === "is" ? usDate(p.lease_end_date) : "",
    list_price: plainNumber(Number(p.list_price)),
    commission_pct: plainNumber(tier.commissionPct),
    // 8(a): only the %. The flat fee is charged at checkout (paragraph 15), not at closing.
    flat_fee: "",
    protection_period_days: String(PROTECTION_PERIOD_DAYS),
    retained_deposits_pct: plainNumber(RETAINED_DEPOSITS_PCT),
    // Paragraph 12 doesn't apply (paragraph 15 (3)): no cancellation fee.
    cancellation_fee: "",
    buyer_comp_pct: buyerOffer.type === "percent" ? plainNumber(buyerOffer.pct) : "",
    buyer_comp_amount: buyerOffer.type === "amount" ? plainNumber(buyerOffer.amount) : "",
    financing_other_specify: otherFits ? otherText : "See Attachment",
    single_agent_broker: BROKERAGE.legalName,
    transaction_broker: BROKERAGE.legalName,
    brokerage_firm_name: BROKERAGE.legalName,
    brokerage_phone: CONTACT.phoneDisplay,
    brokerage_address: BROKERAGE.address,
    ...Object.fromEntries(ADDITIONAL_TERMS_LABELS.map((label, i) => [label, additional[i]])),
  };

  return {
    text,
    // Everything the site writes is read-only, the lease date included (empty = "I don't know").
    lockedText: Object.keys(text),
    checkbox: {
      legal_see_attachment: !legalLines,
      personal_property_see_attachment: !personalFits,
      financing_cash: financing.has("cash"),
      financing_conventional: financing.has("conventional"),
      financing_va: financing.has("va"),
      financing_fha: financing.has("fha"),
      financing_other: financing.has("other"),
      lockbox_authorized: lockbox,
    },
    lockedCheckbox: [
      "legal_see_attachment",
      "personal_property_see_attachment",
      "financing_cash",
      "financing_conventional",
      "financing_va",
      "financing_fha",
      "financing_other",
      "lockbox_authorized",
    ],
    radio: {
      occupancy: { value: occupancy, locked: occupancy !== null, options: ["is", "is_not"] },
      buyer_comp_option: { value: buyerCompOption(buyerOffer), locked: true, options: ["a", "b", "c"] },
    },
    attachment,
    legalStatus: input.verifiedLegal?.trim() ? "verified" : "pending",
  };
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The attachment as an HTML document (DocuSign converts it to PDF and adds it after the
 * agreement). Only what the contract refers to with "See Attachment": no other data.
 */
export function attachmentHtml(sections: AttachmentSection[], propertyLine: string): string {
  const body = sections
    .map((s) => `<h2>${escapeHtml(s.heading)}</h2><p>${escapeHtml(s.body).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;margin:54pt}h1{font-size:14pt}h2{font-size:11pt;margin-top:18pt}</style></head><body><h1>Attachment to Exclusive Right of Sale Listing Agreement</h1><p>Property: ${escapeHtml(propertyLine)}</p>${body}</body></html>`;
}
