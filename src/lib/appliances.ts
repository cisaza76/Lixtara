// Canonical list of appliances a seller can include with the sale (personal
// property). Single source of truth: the listing form, server-side validation,
// the step-6 review, and the DocuSign "Personal Property" prefill all read from
// here. Keys are stable identifiers; human labels live in i18n (step3.appliances).

export const APPLIANCE_KEYS = [
  "refrigerator",
  "range_oven",
  "microwave",
  "dishwasher",
  "garbage_disposal",
  "washer",
  "dryer",
  "water_heater",
  "water_softener",
  "ceiling_fans",
  "window_treatments",
  "garage_door_opener",
] as const;

export type ApplianceKey = (typeof APPLIANCE_KEYS)[number];

const APPLIANCE_SET = new Set<string>(APPLIANCE_KEYS);

/** Keep only valid, de-duplicated appliance keys (server-side guard). */
export function sanitizeAppliances(values: string[]): ApplianceKey[] {
  const seen = new Set<string>();
  const out: ApplianceKey[] = [];
  for (const v of values) {
    if (APPLIANCE_SET.has(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v as ApplianceKey);
    }
  }
  return out;
}
