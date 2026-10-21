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
//   - "Other (specify)" is never filled by the site (the template shows it only with "Other").

import { APPLIANCE_KEYS, sanitizeAppliances } from "@/lib/appliances";
import type { BuyerCompOffer } from "@/lib/buyer-comp";
import { buyerCommissionAck } from "@/lib/buyer-comp";
import type { PricingTier } from "@/lib/pricing-tiers";
import { fitsOnLine, textWidthPt, textField } from "./ers21tn-layout";

export interface AgreementListing {
  address_street: string;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  list_price: number;
  cash_only: boolean | null;
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
  radio: Record<string, { value: string | null; locked: boolean }>;
  /** Sections of the "Attachment to the Listing Agreement" document, if any. */
  attachment: AttachmentSection[];
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
 * Splits `text` over two lines (labels `first`, `second`) word by word. null when it doesn't fit
 * in both: the caller then uses the attachment.
 */
export function splitOverLines(text: string, first: string, second: string): [string, string] | null {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const room = (label: string) => textField(label).width - 2;
  let a = "";
  let i = 0;
  for (; i < words.length; i++) {
    const next = a ? `${a} ${words[i]}` : words[i];
    if (textWidthPt(next) > room(first)) break;
    a = next;
  }
  const b = words.slice(i).join(" ");
  if (!a && words.length > 0) return null;
  return textWidthPt(b) <= room(second) ? [a, b] : null;
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
    attachment.push({
      heading: "Legal Description (line 15)",
      body: input.verifiedLegal?.trim()
        ? input.verifiedLegal.trim()
        : "To be provided by Broker from the official county property record for the Property described in line 13.",
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

  // Lockbox: Concierge always; Pro when the home is vacant. Essentials buys it as an add-on.
  const lockbox = tier.id === "concierge" || (tier.id === "pro" && p.occupancy_status === "vacant");

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
    flat_fee: plainNumber(tier.flatFee),
    buyer_comp_pct: buyerOffer.type === "percent" ? plainNumber(buyerOffer.pct) : "",
    buyer_comp_amount: buyerOffer.type === "amount" ? plainNumber(buyerOffer.amount) : "",
  };

  return {
    text,
    // The lease date stays editable when step 3 didn't give one (the seller writes it).
    lockedText: Object.keys(text).filter((k) => k !== "lease_end_date" || text.lease_end_date !== ""),
    checkbox: {
      legal_see_attachment: !legalLines,
      personal_property_see_attachment: !personalFits,
      financing_cash: p.cash_only === true,
      lockbox_authorized: lockbox,
      buyer_commission_ack: buyerCommissionAck(buyerOffer),
    },
    lockedCheckbox: ["legal_see_attachment", "personal_property_see_attachment", "lockbox_authorized", "buyer_commission_ack"],
    radio: { occupancy: { value: occupancy, locked: occupancy !== null } },
    attachment,
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
