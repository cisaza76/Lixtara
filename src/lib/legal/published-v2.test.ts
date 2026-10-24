// Textos legales v2 publicados (2026-10-18, decisión del owner, sin revisión del abogado
// todavía; docs/legal/2026-10-18-textos-v2-memo.md). Falla si:
//   - falta una página legal o un idioma, o una página escribe su fecha a mano;
//   - queda una marca [VERIFICAR], una leyenda DRAFT/BORRADOR o un marcador sin llenar en
//     algo que se publica (documentos, casillas, diccionario);
//   - se pierde uno de los cinco cambios de la v2;
//   - un documento legal en español usa tú (los documentos van con usted; el sitio, con tú);
//   - el pie de página pierde un enlace legal, la línea de licencia o Equal Housing.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dictionaries } from "@/lib/i18n";
import { LEGAL_DOCS, fillLegalDoc, type LegalDocId } from "./config";
import { CONSENTS, consentFullText } from "./consents";
import { termsDoc } from "./terms";
import { privacyDoc } from "./privacy";
import { cookiesDoc, cookiesDocFor } from "./cookies";
import { disclaimersDoc } from "./disclaimers";
import { noticesDoc } from "./notices";
import { accessibilityDoc } from "./accessibility";
import { dmcaDoc } from "./dmca";
import type { LegalDoc } from "./types";
import { TIER_ORDER } from "@/lib/pricing-tiers";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const LANGS = ["en", "es"] as const;
type Lang = (typeof LANGS)[number];

const TOOL_VARIANTS = [
  { gtm: false, posthog: false },
  { gtm: true, posthog: false },
  { gtm: false, posthog: true },
  { gtm: true, posthog: true },
];

/** Todas las variantes publicables de cada documento, con los marcadores llenos. */
function published(id: LegalDocId, lang: Lang): LegalDoc[] {
  const docs: Record<LegalDocId, LegalDoc[]> = {
    terms: [termsDoc[lang]],
    privacy: [privacyDoc[lang]],
    cookies: TOOL_VARIANTS.map((t) => cookiesDocFor(lang, t)),
    disclaimers: [disclaimersDoc[lang]],
    notices: [noticesDoc[lang]],
    accessibility: [accessibilityDoc[lang]],
    dmca: [dmcaDoc[lang]],
  };
  return docs[id].map(fillLegalDoc);
}

// Sensible a mayúsculas: "todo" y "verificar" son palabras normales en español.
const DRAFT_MARKS = /\[VERIFICAR|VERIFICAR:|\bDRAFT\b|BORRADOR|PENDING LEGAL APPROVAL|PENDIENTE DE APROBACI|\bTODO\b|\bTBD\b/;

describe("páginas legales: todas, en los dos idiomas, desde una sola configuración", () => {
  it.each(Object.keys(LEGAL_DOCS) as LegalDocId[])("%s: página, fecha, versión y contenido EN/ES", (id) => {
    const meta = LEGAL_DOCS[id];
    const page = `src/app/[lang]${meta.path}/page.tsx`;
    expect(existsSync(join(root, page)), page).toBe(true);
    expect(read(page)).toContain(`docId="${id}"`);
    expect(read(page)).not.toMatch(/updatedOn=|\d{4}-\d{2}-\d{2}/);
    expect(meta.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const lang of LANGS) {
      for (const doc of published(id, lang)) {
        expect(doc.title, `${id} ${lang}`).toBeTruthy();
        expect(doc.sections.length, `${id} ${lang}`).toBeGreaterThan(0);
        expect(JSON.stringify(doc), `${id} ${lang}: marcador sin reemplazar`).not.toMatch(/\{[a-zA-Z]+\}/);
      }
    }
  });

  // Los Términos pasaron a la v3 (2026-10-21): published-v3.test.ts.
  it("versión 2026-10-18-v2 en Avisos legales, Avisos de corretaje y Accesibilidad; v4 en Privacidad y Cookies", () => {
    for (const id of ["disclaimers", "notices", "accessibility"] as const) {
      expect(LEGAL_DOCS[id].version, id).toBe("2026-10-18-v2");
      expect(LEGAL_DOCS[id].updated, id).toBe("2026-10-18");
    }
    // 2026-10-24: categoría Publicidad (Meta y Google Ads).
    for (const id of ["privacy", "cookies"] as const) {
      expect(LEGAL_DOCS[id].version, id).toBe("2026-10-24-v4");
      expect(LEGAL_DOCS[id].updated, id).toBe("2026-10-24");
    }
  });

  it("el componente muestra la versión y la fecha de LEGAL_DOCS, con anclas y tablas", () => {
    const c = read("src/components/legal-document.tsx");
    expect(c).toContain("LEGAL_DOCS[docId]");
    expect(c).toContain("{copy.version} {meta.version}");
    expect(c).toContain("id={section.id}");
    expect(c).toContain("section.table");
  });
});

describe("nada de borradores en lo que se publica", () => {
  it.each(Object.keys(LEGAL_DOCS) as LegalDocId[])("%s: sin [VERIFICAR], DRAFT ni BORRADOR (EN/ES, todas las variantes)", (id) => {
    for (const lang of LANGS) {
      for (const doc of published(id, lang)) expect(JSON.stringify(doc), `${id} ${lang}`).not.toMatch(DRAFT_MARKS);
    }
  });

  it("casillas de consentimiento y diccionario del sitio, sin marcas de borrador", () => {
    for (const [doc, def] of Object.entries(CONSENTS)) {
      for (const lang of LANGS) {
        const tiers = def.perPlan ? TIER_ORDER : [null];
        for (const t of tiers) {
          const text = consentFullText(doc as keyof typeof CONSENTS, lang, t);
          expect(text, `${doc} ${lang}`).not.toMatch(DRAFT_MARKS);
          expect(text, `${doc} ${lang}`).not.toMatch(/\{[a-zA-Z]+\}/);
        }
      }
    }
    expect(JSON.stringify(dictionaries)).not.toMatch(/\[VERIFICAR|BORRADOR|PENDING LEGAL APPROVAL/);
  });

  it("los módulos legales no dicen BORRADOR ni [VERIFICAR] ni en comentarios", () => {
    for (const f of ["terms", "privacy", "cookies", "disclaimers", "notices", "accessibility", "providers", "config", "consents", "types"]) {
      expect(read(`src/lib/legal/${f}.ts`), f).not.toMatch(/\[VERIFICAR|VERIFICAR:|BORRADOR|PENDIENTE DE APROBACIÓN/);
    }
  });
});

describe("los cinco cambios de la v2", () => {
  const section = (lang: Lang, n: number) => termsDoc[lang].sections.find((s) => s.id === `section-${n}`)!;

  // La v2 remitía al "Early Termination Addendum"; la v3 remite al párrafo 15 del acuerdo de
  // listado (published-v3.test.ts). Lo que sigue de la v2: sin "24-month listing term".
  it("1. Términos §16: sin '24-month listing term' ni 'any commission obligations'", () => {
    const en = section("en", 16).body.join(" ");
    expect(en).not.toMatch(/24-month listing term|any commission obligations/);
    const es = section("es", 16).body.join(" ");
    expect(es).not.toMatch(/plazo de publicación de 24 meses y cualquier obligación de comisión/);
  });

  it("2. Términos §14 termina con la excepción de fraude, negligencia grave y dolo", () => {
    expect(section("en", 14).body.at(-1)).toBe(
      "This does not apply to fraud, gross negligence, willful misconduct, or duties that cannot be limited under Florida law.",
    );
    expect(section("es", 14).body.at(-1)).toBe(
      "Esto no se aplica al fraude, la negligencia grave, la conducta dolosa ni a los deberes que no pueden limitarse conforme a la ley de Florida.",
    );
  });

  it("2b. Términos §15: sin indemnizar a Lixtara por su propio fraude, negligencia grave o dolo (revisión en preview)", () => {
    expect(section("en", 15).body.at(-1)).toBe(
      "You are not required to indemnify Lixtara for claims caused by Lixtara's own fraud, gross negligence or willful misconduct.",
    );
    expect(section("es", 15).body.at(-1)).toBe(
      "Usted no está obligado a indemnizar a Lixtara por reclamaciones causadas por el fraude, la negligencia grave o la conducta dolosa de la propia Lixtara.",
    );
    for (const lang of LANGS) expect(JSON.stringify(section(lang, 15))).not.toMatch(/This does not apply|Esto no se aplica/);
  });

  it("3. casilla de registro con el arbitraje de la §17 y enlaces (sign-up y paso 7 usan la misma)", () => {
    expect(consentFullText("terms", "en")).toBe(
      "I agree to the Terms of Service, including the arbitration agreement in Section 17, and the Privacy Policy.",
    );
    expect(consentFullText("terms", "es")).toBe(
      "Acepto los Términos de servicio, incluido el acuerdo de arbitraje de la Sección 17, y la Política de privacidad.",
    );
    expect(CONSENTS.terms.links).toEqual(["/terms", "/terms#section-17", "/privacy"]);
    expect(read("src/app/[lang]/sign-up/page.tsx")).toContain('consentCheckbox("terms", lang)');
    expect(read("src/app/[lang]/listing/new/page.tsx")).toContain('consentCheckbox("terms", lang)');
  });

  it("4. Privacidad §2.3: registros públicos y proveedores de datos, con baja en cualquier momento", () => {
    const sub = (lang: Lang) => privacyDoc[lang].sections.flatMap((s) => s.sub ?? []).find((s) => s.heading.startsWith("2.3"))!;
    expect(sub("en").bullets).toContain(
      "Public records and data providers: names and mailing addresses of Florida property owners from the Florida property tax roll and Sunbiz, and email addresses from commercial data providers, used to tell owners about our services. You can unsubscribe at any time.",
    );
    const es = (sub("es").bullets ?? []).join(" ");
    for (const k of [/Registros públicos y proveedores de datos/, /Sunbiz/, /proveedores comerciales de datos/, /Puede darse de baja en cualquier momento/]) {
      expect(es).toMatch(k);
    }
  });

  it("5. Aviso E-SIGN: 'at any time' (sin 'before signing')", () => {
    expect(consentFullText("esign", "en")).toContain("You can withdraw this consent at any time by writing to the same address;");
    expect(consentFullText("esign", "en")).not.toContain("before signing");
    expect(consentFullText("esign", "es")).not.toContain("antes de firmar");
  });
});

describe("registro: documentos legales en español con usted", () => {
  // Formas de tú que no deben aparecer en un documento legal (el sitio y el paso 7 usan tú).
  const TU = /(?<!\p{L})(tú|tu|tus|ti|te devolvemos|puedes|quieres|tienes|cancelas|firmaste|indiques)(?!\p{L})/iu;
  it.each(["terms", "privacy", "cookies", "disclaimers", "notices", "accessibility"] as const)("%s (ES)", (id) => {
    for (const doc of published(id, "es")) {
      const hits = JSON.stringify(doc).match(new RegExp(TU.source, "giu")) ?? [];
      expect(hits, id).toEqual([]);
    }
  });
});

describe("Términos: precios y plazos de pricing-tiers, nombre y correos de brokerage", () => {
  it("terms.ts no escribe a mano precios, porcentajes, licencias ni 'Lixtara LLC'", () => {
    const src = read("src/lib/legal/terms.ts")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    // "0%" (la compensación puede ser 0%) y el tope de responsabilidad "($100)" no son precios de planes.
    expect(src).not.toMatch(/\$\d{2,}(?!\d*\))|\b(?!0%)\d+(\.\d+)?%/);
    expect(src).not.toMatch(/\b(CQ|BK)\d{5,}/);
    expect(src).not.toMatch(/Lixtara LLC/);
  });

  it("muestra los precios y porcentajes de pricing-tiers", async () => {
    const { PRICING_TIERS } = await import("@/lib/pricing-tiers");
    for (const lang of LANGS) {
      const s = JSON.stringify(termsDoc[lang]);
      for (const t of Object.values(PRICING_TIERS)) {
        expect(s, `${lang} ${t.id}`).toContain(`$${t.flatFee}`);
        expect(s, `${lang} ${t.id}`).toContain(`${t.commissionPct}%`);
      }
    }
  });

  it("los avisos de corretaje: licencias y dirección desde brokerage.ts", async () => {
    const { BROKERAGE } = await import("@/config/brokerage");
    for (const lang of LANGS) {
      const s = JSON.stringify(fillLegalDoc(noticesDoc[lang]));
      for (const v of [BROKERAGE.legalName, BROKERAGE.brokerageLicense, BROKERAGE.brokerName, BROKERAGE.brokerLicense, BROKERAGE.address]) {
        expect(s, `${lang} ${v}`).toContain(v);
      }
    }
  });
});

describe("cookies: publicidad solo con consentimiento, en el aviso y en la política (v4, 2026-10-24)", () => {
  it("con GTM: categoría Publicidad con Meta y Google Ads; sin GTM: no hay publicidad", () => {
    for (const lang of LANGS) {
      for (const t of TOOL_VARIANTS) {
        const doc = JSON.stringify(cookiesDocFor(lang, t));
        const noAds = lang === "en" ? /We do not use advertising or targeting cookies/ : /No utilizamos cookies de publicidad/;
        if (t.gtm) {
          expect(doc, `${lang} ${JSON.stringify(t)}`).not.toMatch(noAds);
          expect(doc).toMatch(lang === "en" ? /Advertising Cookies \(only with your consent\)/ : /Cookies de Publicidad \(solo con su consentimiento\)/);
          for (const c of ["_fbp", "_fbc", "_gcl_au", "_gcl_aw"]) expect(doc, c).toContain(c);
        } else {
          expect(doc, `${lang} ${JSON.stringify(t)}`).toMatch(noAds);
        }
      }
    }
    expect(cookiesDocFor("en", TOOL_VARIANTS[0])).toBe(cookiesDoc.en);
    // El aviso ya no dice que no hay publicidad: nombra la categoría.
    expect(dictionaries.en.cookieNotice.consentMessage).not.toContain("No advertising cookies.");
    expect(dictionaries.es.cookieNotice.consentMessage).not.toContain("No usamos cookies de publicidad.");
    expect(dictionaries.en.cookieNotice.consentMessage).toContain("advertising cookies (Meta and Google Ads)");
    expect(dictionaries.es.cookieNotice.consentMessage).toContain("cookies de publicidad (Meta y Google Ads)");
    expect(dictionaries.es.cookieNotice.consentMessage).toContain("{tools}");
  });

  it("las cuatro cookies de publicidad duran 90 días, según Meta y Google", () => {
    for (const lang of LANGS) {
      const ads = cookiesDocFor(lang, { gtm: true, posthog: false }).sections.find((s) => s.id === "advertising")!;
      expect(ads.table!.rows.map((r) => r[0])).toEqual(["_fbp", "_fbc", "_gcl_au", "_gcl_aw"]);
      for (const r of ads.table!.rows) expect(r[3], r[0]).toMatch(lang === "en" ? /^90 days/ : /^90 días/);
    }
  });

  it("privacidad: compartición para publicidad solo con consentimiento, API de Conversiones y retiro", () => {
    for (const lang of LANGS) {
      const s = JSON.stringify(fillLegalDoc(privacyDoc[lang]));
      expect(s).toContain("SHA-256");
      expect(s).toMatch(lang === "en" ? /Conversions API/ : /API de Conversiones/);
      expect(s).toMatch(lang === "en" ? /IP address and your browser's user agent/ : /dirección IP y el agente de usuario/);
      expect(s).toContain("Meta Platforms, Inc.");
      expect(s).toContain("Google LLC (Google Ads)");
      // Ya no afirma que no comparte para publicidad dirigida.
      expect(s).not.toMatch(/do not currently share|actualmente no compart/i);
    }
  });

  it("la tabla de cookies necesarias nombra las cookies reales del sitio", () => {
    const s = JSON.stringify(cookiesDoc.en);
    for (const c of ["lx_consent", "lx_signup_email", "lixtara_cookie_notice_dismissed"]) expect(s, c).toContain(c);
    expect(read("src/components/cookie-notice.tsx")).toContain('"lixtara_cookie_notice_dismissed"');
  });
});

describe("pie de página", () => {
  const layout = read("src/app/[lang]/layout.tsx");
  it("enlaza todas las páginas legales, con su texto en EN y ES", () => {
    for (const id of Object.keys(LEGAL_DOCS)) {
      expect(layout, id).toMatch(new RegExp(`LEGAL_FOOTER_ORDER[^\\n]*"${id}"`));
      for (const lang of LANGS) {
        expect((dictionaries[lang].footer.links as Record<string, string>)[id], `${lang} ${id}`).toBeTruthy();
      }
    }
  });

  it("línea de licencia, nombre legal y Equal Housing Opportunity enlazado a los avisos", () => {
    expect(layout).toContain("brokerageLicenseLine(lang)");
    expect(layout).toContain("footerCopy.licensedBrokerage");
    expect(layout).toContain("{BROKERAGE.legalName}");
    expect(layout).toContain("LEGAL_DOCS.notices.path}#fair-housing");
    expect(read("src/lib/sitemap-routes.ts")).toMatch(/"\/notices",\s*"\/accessibility"/);
  });
});
