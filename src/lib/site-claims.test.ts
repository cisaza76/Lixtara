import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dictionaryTexts, legalTermTexts, type Lang, type SiteText } from "@/lib/site-texts.test-helpers";
import { LOUI_SYSTEM_PROMPT } from "@/lib/loui-prompt";
import { dictionaries } from "@/lib/i18n";
import { BROKERAGE, DBPR_BROKER_LICENSE_URL, DBPR_BROKERAGE_LICENSE_URL, fillBrokerageCopy } from "@/config/brokerage";
import { buyerAgentComp, refundPolicy, termsFaq } from "@/config/legal-terms";
import { BUYER_COMP_MAX_PCT } from "@/lib/buyer-comp";
import { fillTierCopy } from "@/lib/pricing-tiers";
import { termsDoc } from "@/lib/legal/terms";
import { buyNavHref, buyerContactHref, buyerCtaHref, contactTopicFromQuery } from "@/lib/buyer-entry";
import { CONTACT_TOPICS } from "@/lib/contact-form";

// P0 de contenido (2026-10-17): el sitio no afirma lo que no puede respaldar ni promete una
// cancelación absoluta. El respaldo es "Anamaria Velasquez y su equipo" con experiencia, nunca
// antigüedad de licencia. Con el catálogo vacío ningún CTA de compra lleva a /properties.

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function siteTexts(lang: Lang): SiteText[] {
  return [...dictionaryTexts(lang), ...legalTermTexts(lang), { where: "loui-prompt", text: LOUI_SYSTEM_PROMPT }];
}

function hits(texts: SiteText[], patterns: RegExp[]): string[] {
  return texts.flatMap(({ where, text }) =>
    patterns.filter((re) => re.test(text)).map((re) => `${where}: ${re} → "${text.match(re)?.[0]}"`),
  );
}

const UNSUPPORTED: Record<Lang, RegExp[]> = {
  en: [/\bestablished\b/i, /\bmost popular\b/i, /\bmost chosen\b/i, /\blongest in the industry\b/i, /#1\b/, /\bnumber one\b/i, /\bthe best\b/i],
  es: [/\bestablecid[ao]s?\b/i, /\bm[aá]s popular(es)?\b/i, /\bm[aá]s elegid[ao]s?\b/i, /\bm[aá]s larg[ao] de la industria\b/i, /#1\b/, /\bn[uú]mero uno\b/i, /\b(el|la|los|las) mejor(es)?\b/i],
};

const ABSOLUTE_CANCEL: Record<Lang, RegExp[]> = {
  en: [/\bcancel any ?time\b/i, /\bcancel at any time\b/i, /\bno penalt(y|ies)\b/i, /\bwithdraw(\s+\S+){0,3}\s+(at\s+)?any ?time\b/i, /\bno lock-?in\b/i],
  es: [/\bcancela(r)? cuando quieras\b/i, /\bsin penali(dad|zaci[oó]n)(es)?\b/i, /\bretirar(\s+\S+){0,4}\s+en cualquier momento\b/i, /\bsin permanencia\b/i],
};

const LICENSE_TENURE = [/licen[sc]ed for \d+/i, /\d+\+?\s*years? (of being )?licensed/i, /licenciad[ao] (desde hace|por|hace) (m[aá]s de )?\d+/i];

describe.each(["en", "es"] as const)("%s: afirmaciones con respaldo", (lang) => {
  it("sin 'established', 'most popular', 'longest in the industry', '#1' ni 'the best'", () => {
    expect(hits(siteTexts(lang), UNSUPPORTED[lang])).toEqual([]);
  });

  it("sin cancelación absoluta (cancel anytime, no penalty, withdraw anytime, no lock-in)", () => {
    expect(hits(siteTexts(lang), ABSOLUTE_CANCEL[lang])).toEqual([]);
  });

  it("los 20+ años son experiencia del equipo, nunca antigüedad de licencia", () => {
    expect(hits(siteTexts(lang), LICENSE_TENURE)).toEqual([]);
    const hero = dictionaries[lang].hero;
    expect(fillBrokerageCopy(hero.metricYearsLabel)).toContain(BROKERAGE.brokerName);
    expect(fillBrokerageCopy(hero.metricYearsValue)).toMatch(/20/);
  });

  it("hero: sin 'verified', sin porcentajes, con la licencia FL y el enlace al DBPR", () => {
    const hero = JSON.stringify(dictionaries[lang].hero);
    expect(hero).not.toMatch(/verif(ied|icad[ao])/i);
    expect(hero).not.toMatch(/\d\s*%/);
    expect(fillBrokerageCopy(dictionaries[lang].hero.licenseLabel)).toBe(
      lang === "en" ? `FL License #${BROKERAGE.brokerageLicense}` : `Licencia FL #${BROKERAGE.brokerageLicense}`,
    );
    expect(dictionaries[lang].hero.verifyDbpr).toBe(lang === "en" ? "Verify on DBPR" : "Verificar en DBPR");
  });

  it("testimonios: encabezado y nota de clientes de la broker y su equipo", () => {
    const sp = dictionaries[lang].socialProof;
    expect(`${sp.titleBefore}${sp.titleAccent}${sp.titleAfter}`).toBe(lang === "en" ? "What our clients say" : "Lo que dicen nuestros clientes");
    expect(fillBrokerageCopy(sp.note)).toBe(
      lang === "en" ? `Clients of ${BROKERAGE.brokerName} and her team.` : `Clientes de ${BROKERAGE.brokerName} y su equipo.`,
    );
  });

  it("FAQ 'si no se vende': vencimiento definido y salida por el acuerdo de listado", () => {
    const item = dictionaries[lang].faq.items.find((i) => /doesn't sell|no se vende/.test(i.q));
    expect(item?.a).toMatch(lang === "en" ? /defined expiration date of up to 24 months/ : /fecha de vencimiento definida, de hasta 24 meses/);
    expect(item?.a).toMatch(lang === "en" ? /terms of your listing agreement/ : /condiciones de tu acuerdo de listado/);
  });

  it("Términos §6: el reembolso es la política publicada, sin 'all fees are non-refundable'", () => {
    const body = termsDoc[lang].sections.flatMap((s) => s.body).join("\n");
    expect(body).toContain(refundPolicy.text[lang]);
    expect(body).not.toMatch(/all fees paid to Lixtara are non-refundable|todas las tarifas pagadas a Lixtara no son reembolsables/);
    expect(body).not.toMatch(/flat plan fee is non-refundable\.|tarifa fija del plan no es reembolsable\./);
  });

  it("Términos §4.1: la compensación al agente del comprador dice lo mismo que la FAQ", () => {
    const sub = termsDoc[lang].sections.flatMap((s) => s.sub ?? []).find((s) => s.heading.startsWith("4.1"));
    const comp = buyerAgentComp.text[lang];
    expect(sub?.body).toEqual([comp.summary]);
    // Opcional (0%), aparte de la comisión de Lixtara, hasta 3% por política de Lixtara, fuera del MLS.
    expect(comp.summary).toContain(comp.cap);
    expect(comp.cap).toContain(`${BUYER_COMP_MAX_PCT}%`);
    expect(comp.summary).toMatch(lang === "en" ? /0% is allowed/ : /puedes ofrecer 0%/);
    expect(comp.summary).toMatch(lang === "en" ? /separate from the Lixtara commission/ : /aparte de la comisión de Lixtara/);
    expect(comp.summary).toMatch(lang === "en" ? /published on the MLS/ : /no se publica en el MLS/);
    expect(termsFaq(lang).mustOffer.a).toContain(comp.cap);
    const all = JSON.stringify(termsDoc[lang]);
    expect(all).not.toMatch(/set at 3%|se fija en 3%|2% to 3%|2% al 3%|2% and 3%|2% y 3%|cooperating commission|comisión cooperante/i);
  });

  it("Términos: Lixtara LLC y la dirección completa de la configuración de brokerage", () => {
    const all = JSON.stringify(termsDoc[lang]);
    expect(all).not.toMatch(/operated by Lixtara \(|operada por Lixtara \(/);
    expect(termsDoc[lang].intro[0]).toContain(`${BROKERAGE.legalName} (`);
    const contact = termsDoc[lang].sections.find((s) => s.heading.startsWith("21."));
    expect(contact?.body.join("\n")).toContain(`${BROKERAGE.legalName}, ${BROKERAGE.address}`);
    expect(BROKERAGE.address).toBe("181 Vera Ct, Miami, FL 33143");
  });
});

describe("Concierge: la broker dedicada es Anamaria", () => {
  const name = BROKERAGE.brokerName;

  it.each(["en", "es"] as const)("%s: plan, quiz, pasos y FAQ la nombran", (lang) => {
    const d = dictionaries[lang];
    const fill = (t: string) => fillTierCopy(t, "concierge");
    const dedicated = lang === "en" ? `your dedicated broker, ${name}` : `la broker dedicada, ${name}`;
    expect(d.pricing.tiers.concierge.features.map(fill).join("\n").toLowerCase()).toContain(dedicated.toLowerCase());
    expect(fillBrokerageCopy(d.quiz.conciergeWhy)).toContain(dedicated);
    const faq = d.faq.items.map((i) => fillBrokerageCopy(i.a)).join("\n");
    expect(faq).toContain(dedicated);
    const all = siteTexts(lang).map((t) => t.text).join("\n");
    expect(all).not.toMatch(/\ba dedicated broker\b|\bun broker dedicado\b|\bbroker dedicado\b/i);
  });

  it("los pasos de 'Cómo funciona' reemplazan {brokerName} al mostrarse", () => {
    expect(dictionaries.en.howItWorks.steps.some((st) => st.body.includes("{brokerName}"))).toBe(true);
    expect(read("src/app/[lang]/page.tsx")).toContain("{fillCommissionCopy(fillBrokerageCopy(s.body))}");
  });

  it("Loui la nombra y no le quedan placeholders", () => {
    expect(LOUI_SYSTEM_PROMPT).toContain(`Your dedicated broker, ${name}, 7 days a week`);
    expect(LOUI_SYSTEM_PROMPT).not.toMatch(/\{brokerName\}|\{brokerFirstName\}/);
  });
});

describe("entradas de comprador", () => {
  it("con el catálogo vacío nada lleva a /properties", () => {
    for (const lang of ["en", "es"] as const) {
      expect(buyNavHref(lang, false)).toBe(`/${lang}#buyers`);
      expect(buyerCtaHref(lang, false)).toBe(`/${lang}/contact?topic=buy`);
      expect(buyerContactHref(lang)).toBe(`/${lang}/contact?topic=buy`);
    }
  });

  it("con propiedades se vuelve al catálogo", () => {
    expect(buyNavHref("es", true)).toBe("/es/properties");
    expect(buyerCtaHref("en", true)).toBe("/en/properties");
  });

  it("/contact?topic=buy preselecciona el tema; un valor desconocido deja el de siempre", () => {
    expect(contactTopicFromQuery("buy", CONTACT_TOPICS, "sell")).toBe("buy");
    expect(contactTopicFromQuery(["buy", "x"], CONTACT_TOPICS, "sell")).toBe("buy");
    expect(contactTopicFromQuery("hack", CONTACT_TOPICS, "sell")).toBe("sell");
    expect(contactTopicFromQuery(undefined, CONTACT_TOPICS, "sell")).toBe("sell");
  });

  it("el menú, el inicio y la 404 no enlazan /properties a mano", () => {
    for (const f of ["src/app/[lang]/layout.tsx", "src/components/mobile-menu.tsx", "src/app/[lang]/page.tsx", "src/components/not-found-content.tsx", "src/app/[lang]/property/[id]/not-found.tsx", "src/lib/routing/listing-http-status.ts"]) {
      expect(read(f), f).not.toContain("`/${lang}/properties`");
    }
  });

  it("el enlace al DBPR abre la ficha de cada licencia en una pestaña nueva", () => {
    for (const url of [DBPR_BROKERAGE_LICENSE_URL, DBPR_BROKER_LICENSE_URL]) {
      expect(url).toMatch(/^https:\/\/www\.myfloridalicense\.com\/LicenseDetail\.asp\?SID=&id=[0-9A-F]{32}$/);
    }
    expect(DBPR_BROKERAGE_LICENSE_URL).not.toBe(DBPR_BROKER_LICENSE_URL);
    // El inicio enlaza la CQ junto al nombre de la correduría y la BK junto a la licencia de la broker.
    expect(read("src/app/[lang]/page.tsx")).toContain("href={DBPR_BROKER_LICENSE_URL}");
    for (const f of ["src/app/[lang]/page.tsx", "src/app/[lang]/about/page.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("href={DBPR_BROKERAGE_LICENSE_URL}");
      expect(src, f).toContain('target="_blank"');
      expect(src, f).toContain('rel="noopener noreferrer"');
    }
  });

  it("About ya no es 'Coming soon'", () => {
    expect(read("src/app/[lang]/about/page.tsx")).not.toContain("ComingSoon");
  });
});
