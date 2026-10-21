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
  text({ label: "flat_fee", line: 110, page: 3, ...onBlank(299, 410, 81), anchor: "purchase price plus $", locked: true, required: true }),
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
  // ── Page 6 ── the broker signs and dates line 254 herself.
  text({ label: "brokerage_firm_name", line: 255, page: 6, ...onBlank(154.5, 404.5, 253.5), anchor: "Brokerage Firm Name:", locked: true, required: true }),
  text({ label: "brokerage_phone", line: 255, page: 6, ...onBlank(460.5, 571.5, 253.5), locked: true, required: true }),
  text({ label: "brokerage_address", line: 256, page: 6, ...onBlank(92.5, 571, 276.5), locked: true, required: true }),
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
