// Números escritos por el vendedor (regla 2026-10-27). "1,854" en pies² se guardaba como 1
// (parseInt corta en la coma) y ese dato llega al MLS. Aquí, una sola definición por tipo de
// campo que usan el navegador (atributo `pattern`, evaluado como ^(?:patrón)$ con la bandera v)
// y el servidor (parseFormNumber, con la misma expresión):
//   - coma de miles bien agrupada ("1,854", "$500,000"); se quita al guardar;
//   - "$" y espacios se quitan;
//   - nunca se lee un número a medias: si lo que queda no es un número completo, error del campo.
// Baños no tienen miles: "2,5" es 2.5.

const GROUPED = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)`;

export const NUMBER_PATTERNS = {
  /** Entero ≥ 0: habitaciones, lote, parqueo, año. */
  whole: String.raw`\s*${GROUPED}\s*`,
  /** Entero > 0: pies². */
  positiveWhole: String.raw`\s*(?=[\d,]*[1-9])${GROUPED}\s*`,
  /** Dólares enteros (columnas integer o precio de lista): "$500,000" o "500000.00". */
  moneyWhole: String.raw`\s*\$?\s*${GROUPED}(?:\.0{1,2})?\s*`,
  /** Dólares con centavos: renta, compensación en monto. */
  money: String.raw`\s*\$?\s*${GROUPED}(?:\.\d{1,2})?\s*`,
  /** Baños: > 0, decimal con punto o coma ("2.5", "2,5", ".5"). */
  bathrooms: String.raw`\s*(?=[\d.,]*[1-9])(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*`,
} as const;

export type NumberKind = keyof typeof NUMBER_PATTERNS;

const COMPILED = Object.fromEntries(
  Object.entries(NUMBER_PATTERNS).map(([k, p]) => [k, new RegExp(`^(?:${p})$`, "v")]),
) as Record<NumberKind, RegExp>;

export type ParsedNumber = { ok: true; value: number | null } | { ok: false };

/** Vacío → { ok: true, value: null }. Algo que no es un número completo de ese tipo → { ok: false }. */
export function parseFormNumber(raw: unknown, kind: NumberKind): ParsedNumber {
  const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (s === "") return { ok: true, value: null };
  if (!COMPILED[kind].test(s)) return { ok: false };
  const cleaned = s.replace(/[\s$]/g, "");
  const n = Number(kind === "bathrooms" ? cleaned.replace(",", ".") : cleaned.replace(/,/g, ""));
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}
