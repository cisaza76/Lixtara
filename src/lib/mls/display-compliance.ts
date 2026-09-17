// Obligaciones de exhibición del acuerdo de datos de MIAMI AOR.
//
// No son buenas prácticas: son condiciones del Schedule A y del Schedule C, y § VI.B.7
// permite a MIAMI terminar el feed **a su sola discreción** si estima que se violó una
// Regla. Son además lo más fácil de romper en un refactor de UI y lo más visible desde
// fuera — por eso viven en un módulo propio, con tests, en vez de repartidas por JSX.
//
// PURO: sin I/O. La UI consume el resultado.
import type { Locale } from "@/lib/i18n";

/** Nombre registrado de la correduría de Lixtara, tal como figura en el acuerdo. */
export const OWN_BROKERAGE_NAME = "Lixtara, LLC";

// ── Atribución al listing broker — Schedule A §9 ────────────────────────────────────
//
// "All Websites must clearly display the following statement for listings that are not
//  contracted with the Designated REALTOR®/Broker's Brokerage: 'This listing is courtesy
//  of {name of real estate firm}.'"
//
// Y sobre la tipografía, que es la parte que un diseñador rompe sin querer:
// "...must be in the average size font being used on each listing (and not smaller than
//  the median typeface used in the display of Licensed Content), must be in a readily
//  visible color, and in a reasonably prominent location."

export interface ListingAttributionInput {
  listOfficeName: string | null;
  listAgentName?: string | null;
  listOfficePhone?: string | null;
  listOfficeEmail?: string | null;
  listAgentPhone?: string | null;
  listAgentEmail?: string | null;
  /** true cuando la agencia listadora es Lixtara: entonces NO se atribuye a un tercero. */
  isOwnBrokerage: boolean;
}

export interface ListingAttribution {
  /** null = no se muestra atribución (listing propio). */
  courtesyLine: string | null;
  /**
   * Campos extra que el Schedule A §9 exige mostrar SI la correduría listadora los
   * seleccionó. Se muestran los que el feed traiga; los ausentes no se inventan.
   */
  extraFields: string[];
}

/**
 * Atribución de una ficha. Devuelve `courtesyLine: null` para los listings propios —
 * atribuirnos a nosotros mismos no solo es redundante, es incorrecto: la obligación
 * aplica a listings que NO están contratados con nuestra correduría.
 */
export function listingAttribution(
  input: ListingAttributionInput,
  lang: Locale,
): ListingAttribution {
  if (input.isOwnBrokerage) return { courtesyLine: null, extraFields: [] };

  // Sin nombre de oficina no se puede cumplir la obligación. Se degrada al texto
  // genérico en vez de omitir la línea: omitirla sería el incumplimiento.
  const firma = input.listOfficeName?.trim() || (lang === "es" ? "otra firma inmobiliaria" : "another real estate firm");

  const courtesyLine = lang === "es"
    ? `Este listado es cortesía de ${firma}.`
    : `This listing is courtesy of ${firma}.`;

  const extraFields = [
    input.listAgentName,
    input.listOfficePhone,
    input.listOfficeEmail,
    input.listAgentPhone,
    input.listAgentEmail,
  ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);

  return { courtesyLine, extraFields };
}

/**
 * Clases de tipografía para la atribución. Existe como constante y no suelta en el JSX
 * porque el Schedule A §9 fija un mínimo: NO puede ser menor que la mediana usada en la
 * ficha. Es decir, la atribución no va en letra chica — que es justo donde la pondría
 * cualquiera por instinto de diseño.
 */
export const ATTRIBUTION_TYPOGRAPHY = "text-sm text-ink/80";

// ── Aviso de copyright — Schedule A §10 / Schedule C §3 ─────────────────────────────
//
// Texto literal exigido. `year` es parámetro porque el acuerdo lo escribe como "© YYYY"
// y un año quemado en el código queda obsoleto el 1 de enero.

export function mlsCopyrightNotice(year: number): string {
  return (
    `Copyright Southeast Florida MLS a/k/a SEFMLS © ${year}. ` +
    "Accuracy of listing information is not guaranteed. Listing information is provided " +
    "for personal consumer, non-commercial use, solely to identify potential properties " +
    "for potential purchase. All other use is strictly prohibited and may be a violation " +
    "of federal and state law."
  );
}

// ── Disclaimer de fiabilidad — Schedule C §2 ────────────────────────────────────────
//
// "shall display a notice on all Licensed Content displayed indicating that the MLS Data
//  is deemed reliable, but is not guaranteed accurate by MIAMI REALTORS®."

export function reliabilityDisclaimer(lang: Locale): string {
  return lang === "es"
    ? "La información del MLS se considera confiable, pero MIAMI REALTORS® no garantiza su exactitud."
    : "MLS data is deemed reliable, but is not guaranteed accurate by MIAMI REALTORS®.";
}

// ── Elegibilidad de exhibición ──────────────────────────────────────────────────────

export type DisplayBlockReason =
  | "withdrawn"        // retirado del feed; Schedule A exige sacarlo en 24h
  | "not_displayable"; // estado que no corresponde a exhibición pública IDX

/**
 * Estados de RESO que se exhiben públicamente bajo IDX.
 *
 * `Closed` NO está: MIAMI confirmó por escrito que los vendidos del feed pueden mostrarse,
 * pero eso es para el análisis de comparables del vendedor, no para el buscador público de
 * inventario — mezclar casas vendidas entre las disponibles es engañoso para el comprador
 * con independencia de lo que permita el contrato.
 */
export const PUBLICLY_DISPLAYABLE_STATUSES = [
  "Active",
  "Active Under Contract",
  "Pending",
  "Coming Soon",
] as const;

export interface DisplayEligibilityInput {
  mlsStatus: string;
  withdrawnAt: string | null;
}

export function displayEligibility(
  input: DisplayEligibilityInput,
): { displayable: boolean; reason?: DisplayBlockReason } {
  if (input.withdrawnAt !== null) return { displayable: false, reason: "withdrawn" };
  if (!(PUBLICLY_DISPLAYABLE_STATUSES as readonly string[]).includes(input.mlsStatus)) {
    return { displayable: false, reason: "not_displayable" };
  }
  return { displayable: true };
}

// ── Plazos del contrato ─────────────────────────────────────────────────────────────

/** Schedule A §5 y Schedule D §6.g: refrescar al menos cada 24 horas. NO son 15 minutos. */
export const MAX_REFRESH_INTERVAL_HOURS = 24;

/** Schedule A: los listings expirados o retirados salen dentro de 24 horas. */
export const MAX_WITHDRAWAL_LATENCY_HOURS = 24;

/**
 * El cron corre cada 6 horas, así que el peor caso de latencia de retirada son 6 horas
 * frente a las 24 permitidas. Este chequeo existe para que cambiar el cron a un intervalo
 * que incumpla rompa un test, en vez de pasar inadvertido.
 */
export function syncIntervalMeetsContract(intervalHours: number): boolean {
  return intervalHours > 0 && intervalHours <= MAX_WITHDRAWAL_LATENCY_HOURS;
}
