// Step 3: financing the seller accepts → line 23 of the listing agreement (ERS-21tn): Cash,
// Conventional, VA, FHA and Other (with text, required with Other). Same rules as the CHECK
// constraints of migration 20261021120000. cash_only is kept in sync (true = Cash and nothing
// else) until it's retired.

export const FINANCING_TERMS = ["cash", "conventional", "va", "fha", "other"] as const;
export type FinancingTerm = (typeof FINANCING_TERMS)[number];
export const FINANCING_OTHER_MAX = 120;

export type FinancingError = "financing_required" | "financing_other_required" | "financing_other_too_long";

export type FinancingResult =
  | { ok: true; terms: FinancingTerm[]; other: string | null; cashOnly: boolean }
  | { ok: false; error: FinancingError };

export function isFinancingTerm(v: unknown): v is FinancingTerm {
  return (FINANCING_TERMS as readonly unknown[]).includes(v);
}

/** From the step-3 form: the checked boxes (`financing_terms`) and the "Other" text. */
export function parseFinancing(checked: unknown[], otherRaw: unknown): FinancingResult {
  const set = new Set(checked.filter(isFinancingTerm));
  const terms = FINANCING_TERMS.filter((t) => set.has(t));
  if (terms.length === 0) return { ok: false, error: "financing_required" };
  const other = String(otherRaw ?? "").trim().replace(/\s+/g, " ");
  if (!set.has("other")) return { ok: true, terms, other: null, cashOnly: terms.length === 1 && terms[0] === "cash" };
  if (!other) return { ok: false, error: "financing_other_required" };
  if (other.length > FINANCING_OTHER_MAX) return { ok: false, error: "financing_other_too_long" };
  return { ok: true, terms, other, cashOnly: false };
}

/** What the form shows for a saved listing (before the migration: from cash_only). */
export function savedFinancing(row: { financing_terms?: string[] | null; cash_only?: boolean | null }): FinancingTerm[] {
  if (row.financing_terms?.length) return row.financing_terms.filter(isFinancingTerm);
  return row.cash_only ? ["cash"] : [];
}
