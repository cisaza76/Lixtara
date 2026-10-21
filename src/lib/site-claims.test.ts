import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dictionaryTexts, legalTermTexts, sentences, type Lang, type SiteText } from "@/lib/site-texts.test-helpers";
import { LOUI_SYSTEM_PROMPT } from "@/lib/loui-prompt";
import { dictionaries } from "@/lib/i18n";
import { BROKERAGE, CONTACT_EMAIL, DBPR_BROKER_LICENSE_URL, DBPR_BROKERAGE_LICENSE_URL, fillBrokerageCopy } from "@/config/brokerage";
import { buyerAgentComp, refundPolicy, refundPolicyTerms, termsFaq } from "@/config/legal-terms";
import { BUYER_COMP_MAX_PCT } from "@/lib/buyer-comp";
import { PRICING_TIERS, TIER_ORDER, fillTierCopy, formatPrice } from "@/lib/pricing-tiers";
import { fillFromPricing, minCommissionPct, minFlatFee } from "@/lib/pricing-from";
import { ownersContactHref, ownersInstantlyUrl } from "@/lib/owners-landing";
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

  it("los 20+ años son experiencia de la broker, nunca antigüedad de licencia", () => {
    expect(hits(siteTexts(lang), LICENSE_TENURE)).toEqual([]);
  });

  // Decisión del owner (2026-10-18): los años se atribuyen a la broker; el equipo va en una
  // frase aparte, sin sumar años.
  it("insignia y About: la línea de experiencia exacta", () => {
    const line =
      lang === "en"
        ? `${BROKERAGE.brokerName}, Broker · 20+ years in Florida real estate · with her team of licensed agents`
        : `${BROKERAGE.brokerName}, broker · más de 20 años en bienes raíces en Florida · con su equipo de agentes licenciados`;
    expect(fillBrokerageCopy(dictionaries[lang].hero.experienceLine)).toBe(line);
    expect(fillBrokerageCopy(dictionaries[lang].aboutPage.intro)).toBe(line);
  });

  it("ningún texto le atribuye los años al equipo", () => {
    const TEAM_YEARS =
      lang === "en"
        ? [/\bteam,? (with )?\{brokerYears\}/i, /\bteam (with|of) (\d+|\{brokerYears\})\+? years/i, /\bteam,? \d+\+? years/i]
        : [/\bequipo,? (con )?(m[aá]s de )?(\{brokerYears\}|\d+) a[ñn]os/i];
    const raw = JSON.stringify(dictionaries[lang]);
    for (const re of TEAM_YEARS) expect(raw).not.toMatch(re);
    expect(hits(siteTexts(lang), TEAM_YEARS)).toEqual([]);
  });


  it("hero: sin 'verified', sin porcentajes escritos a mano, con la licencia FL y el enlace al DBPR", () => {
    const hero = JSON.stringify(dictionaries[lang].hero);
    expect(hero).not.toMatch(/verif(ied|icad[ao])/i);
    // El único porcentaje es {minPct}, que sale de pricing-tiers.ts.
    expect(hero).not.toMatch(/\d\s*%/);
    expect(fillBrokerageCopy(dictionaries[lang].hero.licenseLabel)).toBe(
      lang === "en" ? `FL License #${BROKERAGE.brokerageLicense}` : `Licencia FL #${BROKERAGE.brokerageLicense}`,
    );
    expect(dictionaries[lang].hero.verifyDbpr).toBe(lang === "en" ? "Verify on DBPR" : "Verificar en DBPR");
  });

  it("testimonios: encabezado y nota de clientes de la broker y su equipo", () => {
    const sp = dictionaries[lang].socialProof;
    expect(`${sp.titleBefore}${sp.titleAccent}${sp.titleAfter}`).toBe(lang === "en" ? "What our clients say" : "Lo que dicen nuestros clientes");
    // Operaciones anteriores a Lixtara (2026-10-18): no son clientes de la plataforma.
    expect(fillBrokerageCopy(sp.note)).toBe(
      lang === "en"
        ? `Clients of ${BROKERAGE.brokerName} and her team, from transactions before Lixtara.`
        : `Clientes de ${BROKERAGE.brokerName} y su equipo, de operaciones anteriores a Lixtara.`,
    );
  });

  it("FAQ 'si no se vende': vencimiento definido y salida por el acuerdo de listado", () => {
    const item = dictionaries[lang].faq.items.find((i) => /doesn't sell|no se vende/.test(i.q));
    expect(item?.a).toMatch(lang === "en" ? /defined expiration date of up to 24 months/ : /fecha de vencimiento definida, de hasta 24 meses/);
    expect(item?.a).toMatch(lang === "en" ? /terms of your listing agreement/ : /condiciones de tu acuerdo de listado/);
  });

  it("Términos §6: el reembolso es la política publicada, sin 'all fees are non-refundable'", () => {
    const body = termsDoc[lang].sections.flatMap((s) => s.body).join("\n");
    // Misma política v2; en español, con usted (registro de los Términos).
    expect(body).toContain(refundPolicyTerms[lang]);
    if (lang === "en") expect(refundPolicyTerms.en).toBe(refundPolicy.text.en);
    else {
      expect(refundPolicyTerms.es).not.toMatch(/\b(tú|tu|te|cancelas)\b/);
      for (const k of [/se cobra se venda o no/, /no se reembolsa una vez/, /broker no aprueba/, /dos veces/, /error técnico/, /antes de la publicación/])
        expect(refundPolicyTerms.es).toMatch(k);
    }
    expect(body).not.toMatch(/all fees paid to Lixtara are non-refundable|todas las tarifas pagadas a Lixtara no son reembolsables/);
    expect(body).not.toMatch(/flat plan fee is non-refundable\.|tarifa fija del plan no es reembolsable\./);
  });

  it("Términos §4.1: la compensación al agente del comprador dice lo mismo que la FAQ", () => {
    const sub = termsDoc[lang].sections.flatMap((s) => s.sub ?? []).find((s) => s.heading.startsWith("4.1"));
    const comp = buyerAgentComp.text[lang];
    expect(sub?.body).toEqual([comp.termsSummary]);
    // Texto v1 del owner (2026-10-18): Lixtara comunica ofertas de hasta 3% del precio de compra;
    // un monto mayor, directo entre el vendedor y el agente del comprador; nunca en el MLS.
    expect(comp.termsSummary).toContain(comp.policyTerms);
    expect(comp.summary).toContain(comp.policy);
    expect(termsFaq(lang).mustOffer.a).toContain(comp.policy);
    if (lang === "en") {
      expect(comp.policy).toBe(
        `Lixtara will communicate and document offers of compensation to a buyer's broker of up to ${BUYER_COMP_MAX_PCT}% of the purchase price, as directed by the seller. The seller may agree to pay a higher amount directly with the buyer's broker; Lixtara will not prevent or discourage it. Compensation is negotiable, not set by law, and never published on the MLS.`,
      );
      expect(comp.policyTerms).toBe(comp.policy);
    } else {
      expect(comp.policy).toMatch(/según lo que tú indiques\. Puedes acordar/);
      expect(comp.policyTerms).toMatch(/según lo que indique el vendedor\. El vendedor puede acordar/);
      expect(comp.policyTerms).not.toMatch(/\b(tú|tu|puedes)\b/);
    }
    for (const t of [comp.policy, comp.policyTerms]) {
      expect(t).toContain(`${BUYER_COMP_MAX_PCT}%`);
      expect(t).toMatch(lang === "en" ? /never published on the MLS/ : /nunca se publica en el MLS/);
      expect(t).toMatch(lang === "en" ? /will not prevent or discourage it/ : /no lo impedirá ni lo desalentará/);
    }
    expect(comp.summary).toMatch(lang === "en" ? /0% is allowed/ : /puedes ofrecer 0%/);
    expect(comp.summary).toMatch(lang === "en" ? /separate from the Lixtara commission/ : /aparte de la comisión de Lixtara/);
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
    expect(read("src/components/home-sections.tsx")).toContain("{fillCommissionCopy(fillBrokerageCopy(s.body))}");
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
    // La insignia de la foto muestra la licencia CQ (BROKER_LICENSE = brokerageLicense): su
    // enlace abre esa misma ficha, nunca la BK.
    const home = read("src/app/[lang]/page.tsx");
    expect(home).toContain("#{BROKER_LICENSE}");
    expect(home).not.toContain("DBPR_BROKER_LICENSE_URL");
    expect(read("src/lib/broker.ts")).toContain("export const BROKER_LICENSE = BROKERAGE.brokerageLicense;");
    // About y /owners muestran los datos con BrokerageFacts.
    for (const f of ["src/app/[lang]/about/page.tsx", "src/app/[lang]/owners/page.tsx"]) {
      expect(read(f), f).toContain("<BrokerageFacts lang={lang} />");
    }
    for (const f of ["src/app/[lang]/page.tsx", "src/components/brokerage-facts.tsx"]) {
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

describe.each(["en", "es"] as const)("%s: ningún texto promete aparecer directamente en un portal", (lang) => {
  it("toda frase que nombra Zillow, Realtor.com, Redfin o Trulia dice que llegan desde el MLS", () => {
    const PORTAL = /\b(Zillow|Realtor\.com|Redfin|Trulia)\b/;
    const VIA_MLS = /\bMLS\b[^.]*\b(syndicat\w*|feeds|distribu\w*|alimenta)\b|\b(syndicat\w*|distribu\w*)\b[^.]*\bMLS\b/i;
    const bad: string[] = [];
    for (const { where, text } of siteTexts(lang)) {
      for (const sentence of sentences(text)) {
        if (!PORTAL.test(sentence)) continue;
        // Mención técnica, no de publicación: los recorridos 3D usan la misma tecnología que Zillow SkyTour.
        if (/SkyTour/.test(sentence)) continue;
        // Desde el MLS (frase anterior o la misma).
        if (VIA_MLS.test(sentence) || /^(From the MLS|Desde el MLS|From there|Desde ahí)(?=[\s,])/.test(sentence)) continue;
        bad.push(`${where}: ${sentence}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("portada: hero nuevo (2026-10-18)", () => {
  const fee = formatPrice(Math.min(...TIER_ORDER.map((id) => PRICING_TIERS[id].flatFee)));
  const pct = `${Math.min(...TIER_ORDER.map((id) => PRICING_TIERS[id].commissionPct))}%`;

  it("precios del plan más bajo, desde pricing-tiers.ts", () => {
    expect(minFlatFee()).toBe(Math.min(...TIER_ORDER.map((id) => PRICING_TIERS[id].flatFee)));
    expect(minCommissionPct()).toBe(Math.min(...TIER_ORDER.map((id) => PRICING_TIERS[id].commissionPct)));
    expect(fillFromPricing("{minFee} {minPct}")).toBe(`${fee} ${pct}`);
    expect(pct).not.toMatch(/,/); // decimal con punto
  });

  it.each(["en", "es"] as const)("%s: titular, subtítulo y CTA exactos", (lang) => {
    const hero = dictionaries[lang].hero;
    const title = `${hero.headlineBefore}${hero.headlineAccent}${hero.headlineAfter}`;
    const sub = fillFromPricing(fillBrokerageCopy(hero.subheadline));
    if (lang === "en") {
      expect(title).toBe("Sell your Florida home. Keep more of what you've earned.");
      expect(sub).toBe(`List on the MLS with a licensed brokerage and a broker with 20+ years of experience. Plans from ${fee}, plus ${pct} only if your home sells.`);
      expect([hero.ctaPrimary, hero.ctaSecondary]).toEqual(["See what you'd pay", "Start my listing"]);
    } else {
      expect(title).toBe("Vende tu casa en Florida. Quédate con más de lo que ganaste.");
      expect(sub).toBe(`Publica en el MLS con una inmobiliaria licenciada y una broker con más de 20 años de experiencia. Planes desde ${fee}, más ${pct} solo si tu casa se vende.`);
      expect([hero.ctaPrimary, hero.ctaSecondary]).toEqual(["Calcula cuánto pagarías", "Publicar mi casa"]);
    }
  });

  it("el CTA principal va a la calculadora y el secundario al registro (home_hero)", () => {
    const src = read("src/app/[lang]/page.tsx");
    expect(src).toContain("href={`#${CALCULATOR_ANCHOR}`}");
    expect(src).toContain('location="home_hero"');
    expect(src).toContain("fillFromPricing(fillBrokerageCopy(copy.subheadline))");
    expect(read("src/components/home-sections.tsx")).toContain("id={CALCULATOR_ANCHOR}");
    // Franja de confianza del #207 debajo del hero.
    expect(src).toContain("href={DBPR_BROKERAGE_LICENSE_URL}");
    expect(src).toContain("fillBrokerageCopy(copy.experienceLine)");
    expect(src).toContain("copy.metricMlsValue");
  });
});

describe("landing de propietarios (/owners)", () => {
  const src = read("src/app/[lang]/owners/page.tsx");

  it.each(["en", "es"] as const)("%s: hero y CTA exactos", (lang) => {
    const c = dictionaries[lang].ownersPage;
    const title = `${c.titleBefore}${c.titleAccent}${c.titleAfter}`;
    if (lang === "en") {
      expect(title).toBe("A licensed Florida brokerage. A fraction of the commission.");
      expect(fillBrokerageCopy(c.intro)).toBe(
        `${BROKERAGE.brokerName}, with 20+ years in Florida real estate, and her team put your home on the MLS, which feeds Zillow, Realtor.com and Redfin. You pay a flat fee, plus a small commission only if it sells.`,
      );
      expect([c.ctaListing, c.ctaTalk]).toEqual(["Start my listing", "Talk to our team"]);
    } else {
      expect(title).toBe("Una inmobiliaria licenciada en Florida. Una fracción de la comisión.");
      expect(fillBrokerageCopy(c.intro)).toBe(
        `${BROKERAGE.brokerName}, con más de 20 años en el mercado inmobiliario de Florida, y su equipo ponen tu casa en el MLS, que alimenta a Zillow, Realtor.com y Redfin. Pagas una tarifa fija, más una comisión baja solo si se vende.`,
      );
      expect([c.ctaListing, c.ctaTalk]).toEqual(["Publicar mi casa", "Hablar con nuestro equipo"]);
    }
    expect(fillBrokerageCopy(c.whoTitle)).toContain(BROKERAGE.legalName);
  });

  it.each(["en", "es"] as const)("%s: FAQ de correo frío; bajas a CONTACT_EMAIL", (lang) => {
    const [why, where, stop] = dictionaries[lang].ownersPage.faq;
    expect(why.q).toBe(lang === "en" ? "Why did I get this email?" : "¿Por qué recibí este correo?");
    expect(where.q).toBe(lang === "en" ? "Where did you get my information?" : "¿De dónde sacaron mis datos?");
    // Fuentes reales (decisión del owner, 2026-10-18; igual que Privacidad §2.3): registros
    // públicos para nombres y direcciones, proveedores comerciales para los correos.
    expect(where.a).toBe(
      lang === "en"
        ? "Names and mailing addresses come from public records (the Florida property tax roll and Sunbiz). Email addresses come from commercial data providers. We never sell your information."
        : "Los nombres y direcciones vienen de registros públicos (el padrón del impuesto a la propiedad de Florida y Sunbiz). Los correos vienen de proveedores comerciales de datos. Nunca vendemos tu información.",
    );
    // Ningún texto del sitio dice que no compramos datos.
    expect(JSON.stringify(dictionaries[lang])).not.toMatch(/don.t buy|do not buy|never buy|no compramos|nunca compramos|listas de datos personales/i);
    expect(stop.q).toBe(lang === "en" ? "How do I stop receiving emails?" : "¿Cómo dejo de recibir correos?");
    expect(stop.a).toContain("{contactEmail}");
    // Enlace de baja: de inmediato. Por correo: hasta 10 días hábiles (plazo de CAN-SPAM).
    expect(stop.a.replace("{contactEmail}", CONTACT_EMAIL)).toBe(
      lang === "en"
        ? `Use the unsubscribe link in any email and you're removed right away. If you email ${CONTACT_EMAIL} instead, we'll remove you within 10 business days.`
        : `Usa el enlace ‘unsubscribe’ de cualquier correo y te quitamos de inmediato. Si prefieres escribir a ${CONTACT_EMAIL}, te quitamos en un máximo de 10 días hábiles.`,
    );
    expect(JSON.stringify(dictionaries[lang].ownersPage)).not.toMatch(/@lixtara\.com/);
  });

  it("el correo de bajas es una sola constante", () => {
    expect(CONTACT_EMAIL).toBe("camilo@lixtara.com");
    expect(src).toContain("mailto:${CONTACT_EMAIL}");
  });

  it("orden: hero, quién te escribe, calculadora, cómo funciona, planes, FAQ, CTA final", () => {
    const order = [
      'location="owners_hero"',
      "<BrokerageFacts lang={lang} />",
      "<SavingsSection lang={lang} />",
      "<HowItWorksSection lang={lang} />",
      "<PricingSection lang={lang} />",
      "<FaqList items={faqItems} />",
      'location="owners_footer"',
    ].map((m) => src.indexOf(m));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // FAQ de costo total y reembolso desde legal-terms.ts.
    expect(src).toContain("legalFaq.total");
    expect(src).toContain("legalFaq.refund");
  });

  it("noindex, fuera del menú y del sitemap, sin personalizar con datos del propietario", () => {
    expect(src).toContain("robots: { index: false, follow: true }");
    expect(src).not.toMatch(/searchParams/);
    for (const f of ["src/app/[lang]/layout.tsx", "src/components/mobile-menu.tsx", "src/app/sitemap.ts", "src/lib/sitemap-routes.ts"]) {
      expect(read(f), f).not.toMatch(/\/owners/);
    }
  });

  it("'Talk to our team' abre el contacto con el tema 'sell'", () => {
    expect(CONTACT_TOPICS).toContain("sell");
    expect(ownersContactHref("es")).toBe("/es/contact?topic=sell");
    expect(contactTopicFromQuery("sell", CONTACT_TOPICS, "other")).toBe("sell");
  });

  it("enlace de Instantly: solo UTM, sin datos del propietario", () => {
    expect(ownersInstantlyUrl("https://lixtara.com", "en", "fl-owners-2026-10")).toBe(
      "https://lixtara.com/en/owners?utm_source=instantly&utm_medium=email&utm_campaign=fl-owners-2026-10",
    );
  });

  it("calculadora: a 375 px 'Personalizado' va en su propia fila (sin desborde)", () => {
    const slider = read("src/components/savings-slider.tsx");
    expect(slider).toContain('className="grid grid-cols-4 sm:grid-cols-5 gap-2"');
    expect(slider).toContain('o.value === "custom" ? "col-span-4 sm:col-span-1" : ""');
  });

  it("calculadora en móvil: una tarjeta por columna (tradicional + 3 planes); la tabla desde md", () => {
    const slider = read("src/components/savings-slider.tsx");
    expect(slider).toContain('<ul className="md:hidden flex flex-col gap-4">');
    expect(slider).toContain('<div className="hidden md:block overflow-x-auto">');
    // Cada tarjeta trae el total y, en los planes, el ahorro.
    expect(slider).toMatch(/md:hidden[\s\S]*copy\.lineTotal[\s\S]*copy\.lineSavings[\s\S]*hidden md:block/);
  });

  it("Loui en móvil: el botón flotante se oculta mientras tapa un enlace, botón o campo", () => {
    const loui = read("src/components/loui-widget.tsx");
    expect(loui).toContain("const covering = useCoversInteractive(buttonRef, !open);");
    expect(loui).toContain('const MOBILE = "(max-width: 767px)";');
    expect(loui).toContain('covering ? "opacity-0 pointer-events-none" : "opacity-100"');
  });

  it("cuenta visitas en funnel_events solo con el idioma, después de responder", () => {
    expect(src).toContain('after(() => recordPageViewEvent("owners_landing_view", lang))');
    expect(src).toContain("isHumanPageView(");
  });
});
