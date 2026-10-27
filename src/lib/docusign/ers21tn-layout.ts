// Layout of the fields Lixtara fills on the Listing Agreement template (Florida Realtors
// ERS-21tn, Demo account, measured 2026-10-21 on the template's own PDF: margin line numbers by
// OCR, blank lines and printed boxes from the page image). ONE source for:
//   - src/lib/docusign/listing-agreement-tabs.ts (what fits on each line);
//   - scripts/docusign/apply-template-fixes.ts (where each tab goes on the template).
// Field map with every tab, its origin and the errors found: docs/docusign/field-map-ers21tn.md.
//
// The ERS-21tn PDF is a scanned image (no text layer), so DocuSign anchor tabs can't find any
// text on it: positions are coordinates, in points from the page's top-left corner. The
// licensed production form may be a real PDF: apply-template-fixes takes an `anchor` per field
// and uses it when the PDF has text.
//
// How DocuSign draws them (checked on signed Demo envelopes, 2026-10-15 and 2026-10-21):
//   - a 9 pt text tab's value has its middle ~9.5 pt below the tab's top, whatever its height
//     → y = underline − 14 puts the text just above the line (−10 struck it through);
//   - a checkbox tab is drawn ~4 pt right of and below its position → x/y = printed box − 4.

export const ERS21TN_FONT_SIZE_PT = 9;
const TEXT_HEIGHT = 11;

export type TextField = {
  kind: "text";
  label: string;
  /** Form line number (the numbers printed in the left margin). */
  line: number;
  page: number;
  x: number;
  y: number;
  width: number;
  /** Text printed right before the blank, when the licensed PDF has a text layer. */
  anchor?: string;
  /** Filled by the site from the listing: the seller can't change it in DocuSign. */
  locked: boolean;
  required: boolean;
  /** Shown only when another tab has a value (radio value or checked checkbox "on"). */
  conditional?: { parentLabel: string; parentValue: string };
};

export type CheckboxField = {
  kind: "checkbox";
  label: string;
  line: number;
  page: number;
  x: number;
  y: number;
  locked: boolean;
};

export type RadioGroupField = {
  kind: "radio";
  groupName: string;
  line: number;
  page: number;
  locked: boolean;
  required: boolean;
  radios: Array<{ value: string; x: number; y: number }>;
};

export type LayoutField = TextField | CheckboxField | RadioGroupField;

const text = (f: Omit<TextField, "kind">): TextField => ({ kind: "text", ...f });
const box = (f: Omit<CheckboxField, "kind">): CheckboxField => ({ kind: "checkbox", ...f });

/** Text tab on the blank that runs from x0 to x1 with its underline at u (all in points). */
const onBlank = (x0: number, x1: number, u: number) => ({ x: x0 + 2, y: u - 14, width: x1 - x0 - 4 });
/** Checkbox tab over the printed box whose top-left corner is (bx, by). */
const overBox = (bx: number, by: number) => ({ x: bx - 4, y: by - 4 });

const ADDITIONAL_TERMS_UNDERLINES = [350.5, 370.5, 390.5, 410.5, 430.5, 451, 471, 491, 511.5, 531.5, 551.5, 571.5, 591.5, 611.5, 631.5];

export const ERS21TN_FIELDS: LayoutField[] = [
  // ── Page 1 ──
  text({ label: "seller_name", line: 2, page: 1, ...onBlank(51, 529, 96), locked: true, required: true }),
  text({ label: "broker_name", line: 3, page: 1, ...onBlank(118, 524, 113), anchor: "and brokerage", locked: true, required: true }),
  text({ label: "start_date", line: 6, page: 1, ...onBlank(69, 180, 158), locked: true, required: true }),
  text({ label: "termination_date", line: 6, page: 1, ...onBlank(330, 441, 158), anchor: "11:59 p.m. on", locked: true, required: true }),
  text({ label: "street_address", line: 13, page: 1, ...onBlank(164, 576, 244.5), anchor: "Street Address:", locked: true, required: true }),
  text({ label: "city_state_zip", line: 14, page: 1, ...onBlank(87, 390, 261.5), locked: true, required: true }),
  text({ label: "legal_description", line: 15, page: 1, ...onBlank(170, 576, 284.5), anchor: "Legal Description:", locked: true, required: false }),
  text({ label: "legal_description_2", line: 16, page: 1, ...onBlank(87, 376, 306), locked: true, required: false }),
  box({ label: "legal_see_attachment", line: 16, page: 1, ...overBox(384, 296.5), locked: true }),
  text({ label: "personal_property", line: 17, page: 1, ...onBlank(284, 576, 324), anchor: "including appliances:", locked: true, required: false }),
  box({ label: "personal_property_see_attachment", line: 18, page: 1, ...overBox(384, 331), locked: true }),
  {
    kind: "radio",
    groupName: "occupancy",
    line: 20,
    page: 1,
    // Locked when the site sends the step-3 answer; the seller picks only if it's missing.
    locked: false,
    required: true,
    radios: [
      { value: "is", ...overBox(132, 360.5) },
      { value: "is_not", ...overBox(155.5, 360.5) },
    ],
  },
  text({
    label: "lease_end_date",
    line: 20,
    page: 1,
    ...onBlank(489, 572, 369),
    anchor: "lease term expires",
    // Filled by the site from step 3 (empty when the seller chose "I don't know").
    locked: true,
    required: false,
    conditional: { parentLabel: "occupancy", parentValue: "is" },
  }),
  text({ label: "list_price", line: 22, page: 1, ...onBlank(123, 234, 398), anchor: "Price: $", locked: true, required: true }),
  box({ label: "financing_cash", line: 23, page: 1, ...overBox(175.5, 401), locked: true }),
  box({ label: "financing_conventional", line: 23, page: 1, ...overBox(217, 401), locked: true }),
  box({ label: "financing_va", line: 23, page: 1, ...overBox(292.5, 401), locked: true }),
  box({ label: "financing_fha", line: 23, page: 1, ...overBox(323, 401), locked: true }),
  box({ label: "financing_other", line: 23, page: 1, ...overBox(361, 401), locked: true }),
  text({
    label: "financing_other_specify",
    line: 23,
    page: 1,
    ...onBlank(442, 575, 409.5),
    anchor: "Other (specify)",
    // Financing terms come from step 3 (Cash, Conventional, VA, FHA, Other + text).
    locked: true,
    required: false,
    conditional: { parentLabel: "financing_other", parentValue: "on" },
  }),
  // ── Page 2 ──
  box({ label: "lockbox_authorized", line: 71, page: 2, ...overBox(191, 295), locked: true }),
  // ── Page 3 ──
  text({ label: "commission_pct", line: 110, page: 3, ...onBlank(87, 142, 81), locked: true, required: true }),
  // 8(a): only the %; the "plus $" stays empty (the flat fee is charged at checkout, paragraph 15).
  text({ label: "flat_fee", line: 110, page: 3, ...onBlank(299, 410, 81), anchor: "purchase price plus $", locked: true, required: false }),
  // Paragraph 8(d)(3) and 8(e): PROTECTION_PERIOD_DAYS and RETAINED_DEPOSITS_PCT (src/config/listing-agreement.ts).
  text({ label: "protection_period_days", line: 123, page: 3, ...onBlank(297.5, 330.5, 229), locked: true, required: true }),
  text({ label: "retained_deposits_pct", line: 128, page: 3, ...onBlank(485.5, 518.5, 288), locked: true, required: true }),
  {
    // Paragraph 10, one option: Lixtara's model is that the seller pays the buyer's broker apart
    // from Lixtara's commission → 10(b), with the amount on line 150; 0% → 10(c). Never 10(a)
    // (paid out of Broker's compensation). Owner, 2026-10-21.
    kind: "radio",
    groupName: "buyer_comp_option",
    line: 145,
    page: 3,
    locked: true,
    required: true,
    radios: [
      { value: "a", ...overBox(122.5, 498) },
      { value: "b", ...overBox(122.5, 550) },
      { value: "c", ...overBox(122.5, 590) },
    ],
  },
  text({ label: "buyer_comp_pct", line: 150, page: 3, ...onBlank(122.5, 156, 571.5), locked: true, required: false }),
  text({ label: "buyer_comp_amount", line: 150, page: 3, ...onBlank(281, 364.5, 571.5), locked: true, required: false }),
  // ── Page 4 ──
  text({ label: "single_agent_broker", line: 159, page: 4, ...onBlank(132.5, 575.5, 98.5), anchor: "As a single agent,", locked: true, required: true }),
  // The form prints "171" a second time, after line 181.
  text({ label: "transaction_broker", line: 171, page: 4, ...onBlank(158.5, 576, 417.5), anchor: "As a transaction broker,", locked: true, required: true }),
  // ── Page 5 ──
  // Paragraph 12: empty and read-only; paragraph 15 says it doesn't apply.
  text({ label: "cancellation_fee", line: 207, page: 5, ...onBlank(406, 517, 69.5), anchor: "cancellation fee of $", locked: true, required: false }),
  // Paragraph 15, Additional Terms: one tab per printed line (L230–244, ~20 pt apart; underlines
  // measured on the template image, L236's interpolated), filled in order.
  ...ADDITIONAL_TERMS_UNDERLINES.map((u, i) =>
    text({ label: `additional_terms_${i + 1}`, line: 230 + i, page: 5, ...onBlank(i === 0 ? 157.5 : 50.5, i === 0 ? 569 : 567.5, u), ...(i === 0 ? { anchor: "Additional Terms:" } : {}), locked: true, required: false }),
  ),
  // ── Page 6 ──
  // Lines 247–249, the seller's contact (owner, 2026-10-26): phone on "Home Telephone" (Work
  // Telephone and Facsimile stay blank), the mailing address (the property's: the site has no
  // other), the email. Lines 251–253 are a second seller's: blank. Underlines measured on the
  // template image, 2026-10-26.
  text({ label: "seller_phone", line: 247, page: 6, ...onBlank(132.8, 232.9, 69.7), anchor: "Home Telephone:", locked: true, required: false }),
  text({ label: "seller_address", line: 248, page: 6, ...onBlank(92.9, 571.3, 92.7), locked: true, required: true }),
  text({ label: "seller_email", line: 249, page: 6, ...onBlank(120.6, 571.3, 116.1), locked: true, required: true }),
  // The broker signs and dates line 254 herself.
  text({ label: "brokerage_firm_name", line: 255, page: 6, ...onBlank(154.5, 404.5, 253.5), anchor: "Brokerage Firm Name:", locked: true, required: true }),
  text({ label: "brokerage_phone", line: 255, page: 6, ...onBlank(460.5, 571.5, 253.5), locked: true, required: true }),
  text({ label: "brokerage_address", line: 256, page: 6, ...onBlank(92.5, 571, 276.5), locked: true, required: true }),
  // Line 257, "Copy returned to Seller on ____ by [x] email": DocuSign emails every signer the
  // completed envelope, so "email" is checked and read-only. The date is the broker's
  // dateSigned (ERS21TN_BROKER_SIGNATURES). Box measured on the template image, 2026-10-26.
  box({ label: "copy_returned_by_email", line: 257, page: 6, ...overBox(333.7, 307.8), locked: true }),
];

/**
 * Initials on each page's footer: "Seller (____) (____) and Broker/Authorized Associate (____)
 * (____)". The first blank of each party, 24 pt wide, underline at y 726 on every page; the
 * text above ends at y 712 (page 2). The template had them ~40 pt higher, over lines 47–48,
 * 105–106 and 204, and on page 6 over the form's footer. Checked on signed envelopes
 * (2026-10-21): at y 708 the stamp sits between the parentheses and DocuSign's frame label
 * clears the text above; the frame's bottom edge touches the next line. `scale` = DocuSign's
 * scaleValue (0.5 is its minimum): the full-size stamp (~32×29 pt) doesn't fit in the blank.
 */
export type InitialField = { role: "Seller" | "Broker"; page: number; x: number; y: number; scale: number };
const FOOTER_BLANK = { Seller: 77.5, Broker: 267 } as const;
export const ERS21TN_INITIALS: InitialField[] = ([1, 2, 3, 4, 5, 6] as const).flatMap((page) =>
  (["Seller", "Broker"] as const).map((role) => ({ role, page, x: FOOTER_BLANK[role] + 3, y: 708, scale: 0.5 })),
);

/**
 * The seller's signature and date on page 4: the single agent notice (lines 171–172) and the
 * consent to transition to transaction broker (lines 201–202). Owner, 2026-10-21: single agent
 * with consent to transition (paragraph 6(f)); both required.
 *
 * Lines 173–174 and 203–204 are for a second seller. The site has one seller per agreement (one
 * "Seller" role on the envelope, no co-owner in the listing), so they get no tabs: they stay
 * blank. A second seller needs a second role on the template and the co-owner in the data first.
 *
 * Signature: 22 pt of free space between the text above and the line (measured on the template
 * image, 2026-10-21); the full-size stamp with its frame is ~34 pt, at `scale` 0.65 ~22 pt. Its
 * frame is drawn from ~4 pt to ~37.5 pt below the tab's y (× scale), so y puts the frame's
 * bottom 1.5 pt below the line. Date: same rule as a 9 pt text tab.
 */
export type SignatureField = { kind: "signHereTabs" | "dateSignedTabs"; label: string; line: number; page: number; x: number; y: number; scale?: number };
const SIGN_SCALE = 0.65;
const signOnLine = (x0: number, u: number) => ({ x: x0 + 2, y: Math.round(u + 1.5 - 37.5 * SIGN_SCALE), scale: SIGN_SCALE });
const dateOnLine = (x0: number, u: number) => ({ x: x0 + 2, y: u - 14 });
export const ERS21TN_SELLER_SIGNATURES: SignatureField[] = [
  { kind: "signHereTabs", label: "single_agent_signature", line: 171, page: 4, ...signOnLine(50.5, 255) },
  { kind: "dateSignedTabs", label: "single_agent_date", line: 171, page: 4, ...dateOnLine(436, 255) },
  { kind: "signHereTabs", label: "transition_consent_signature", line: 201, page: 4, ...signOnLine(50.5, 666) },
  { kind: "dateSignedTabs", label: "transition_consent_date", line: 201, page: 4, ...dateOnLine(436, 666) },
];

/**
 * The broker's date on line 257 ("Copy returned to Seller on ____"): blank 191.5–308.5,
 * underline at 315.5. The broker signs last (routing order 2), so her dateSigned is the day
 * DocuSign completes the envelope and emails the copy. Owner, 2026-10-26: DocuSign sets it.
 */
export const ERS21TN_BROKER_SIGNATURES: SignatureField[] = [
  { kind: "dateSignedTabs", label: "copy_returned_date", line: 257, page: 6, ...dateOnLine(191.5, 315.5) },
];

/** Height of every text tab: one line, no auto-grow. */
export const ERS21TN_TEXT_HEIGHT = TEXT_HEIGHT;

// Arial/Helvetica advance widths (AFM, 1/1000 em) for printable ASCII; anything else counts as "M".
const W =
  "278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584"
    .split(",")
    .map(Number);

/** Printed width of `s` in points at `sizePt` (Arial metrics). */
export function textWidthPt(s: string, sizePt = ERS21TN_FONT_SIZE_PT): number {
  let units = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    units += c >= 32 && c <= 126 ? W[c - 32] : 833;
  }
  return (units / 1000) * sizePt;
}

export function textField(label: string): TextField {
  const f = ERS21TN_FIELDS.find((x): x is TextField => x.kind === "text" && x.label === label);
  if (!f) throw new Error(`ERS-21tn layout has no text field "${label}"`);
  return f;
}

/** Whether `value` fits on its line without being cut (2 pt of slack for DocuSign's padding). */
export function fitsOnLine(label: string, value: string): boolean {
  return textWidthPt(value) <= textField(label).width - 2;
}
