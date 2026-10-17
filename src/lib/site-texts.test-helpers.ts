// Textos visibles del sitio para los tests de términos y glosario: diccionarios EN/ES (con los
// placeholders resueltos), la configuración de términos y el prompt de Loui. Los correos se
// suman en cada test (necesitan el mock de Resend).

import { dictionaries } from "@/lib/i18n";
import { fillBrokerageCopy } from "@/config/brokerage";
import { fillCommissionCopy, fillPricingCopy } from "@/lib/pricing-tiers";
import { LEGAL_TERMS } from "@/config/legal-terms";

export type Lang = "en" | "es";

export interface SiteText {
  where: string;
  text: string;
}

function walk(o: unknown, path: string, out: SiteText[]) {
  if (typeof o === "string") out.push({ where: path, text: fillBrokerageCopy(fillCommissionCopy(fillPricingCopy(o))) });
  else if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`, out);
}

export function dictionaryTexts(lang: Lang): SiteText[] {
  const out: SiteText[] = [];
  walk(dictionaries[lang], lang, out);
  return out;
}

export function legalTermTexts(lang: Lang): SiteText[] {
  const out: SiteText[] = [];
  for (const [k, def] of Object.entries(LEGAL_TERMS)) walk(def.text[lang], `legal-terms.${k}.${lang}`, out);
  return out;
}

/** Frases (hasta el punto) de un texto, para reglas que miran una oración a la vez. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}
