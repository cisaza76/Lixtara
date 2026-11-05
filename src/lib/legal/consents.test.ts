import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { CONSENTS, PUBLISHED_CONSENT_HASHES, consentCheckbox, consentFullText, consentNotice } from "./consents";
import { consentTextHash } from "./consents.server";
import { LEGAL_DOCS, fillLegalDoc } from "./config";
import { termsDoc } from "./terms";
import { privacyDoc } from "./privacy";
import { disclaimersDoc } from "./disclaimers";
import { refundPolicy, refundPolicyTerms, termsFaq } from "@/config/legal-terms";
import {
  BROKERAGE,
  CONTACT_EMAIL,
  DMCA_EMAIL,
  LEGAL_EMAIL,
  NOTICES_EMAIL,
  PRIVACY_EMAIL,
  SUPPORT_EMAIL,
} from "@/config/brokerage";
import { PRICING_TIERS, TIER_ORDER, formatPrice } from "@/lib/pricing-tiers";

// Textos legales v2 (2026-10-18), publicados por decisión del owner; la v1 se conserva para
// reconstruir las aceptaciones registradas con ella.
const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("casilla del paso 8 (terms_refund)", () => {
  it.each(TIER_ORDER)("%s: texto exacto con el precio y la comisión del plan", (tier) => {
    const fee = formatPrice(PRICING_TIERS[tier].flatFee);
    const pct = `${PRICING_TIERS[tier].commissionPct}%`;
    // v3 (2026-10-21): terminación sin costo y comisión al cierre (modelo final del owner).
    expect(consentCheckbox("terms_refund", "en", tier).before).toBe(
      `I understand that the ${fee} flat fee is charged whether or not my home sells and is non-refundable once my home is published on the MLS. If my listing ends before publication, I receive a full refund. I can end my listing agreement at any time, at no charge. The ${pct} commission is due only if a sale closes, and it's paid at closing.`,
    );
    expect(consentCheckbox("terms_refund", "es", tier).before).toBe(
      `Entiendo que la tarifa fija de ${fee} se cobra se venda o no mi propiedad y que no es reembolsable una vez publicada en el MLS. Si mi listado termina antes de la publicación, recibo el reembolso total. Puedo terminar mi acuerdo de listado en cualquier momento, sin costo. La comisión del ${pct} solo se paga si la venta se cierra, al momento del cierre.`,
    );
    expect(pct).not.toMatch(/,/); // decimal con punto
  });

  it.each(TIER_ORDER)("%s: las v1 y v2 (sin tarifa de cancelación) siguen reconstruyéndose", (tier) => {
    const fee = formatPrice(PRICING_TIERS[tier].flatFee);
    const pct = `${PRICING_TIERS[tier].commissionPct}%`;
    for (const v of ["2026-10-18-v1", "2026-10-18-v2"]) {
      expect(consentCheckbox("terms_refund", "en", tier, v).before, v).toBe(
        `I understand that the ${fee} flat fee is charged whether or not my home sells and is non-refundable once my home is published on the MLS. If my listing ends before publication, I receive a full refund. The ${pct} commission is due only if a sale closes.`,
      );
    }
  });

  it("sin plan no se puede armar (el texto lleva {fee} y {pct})", () => {
    expect(() => consentCheckbox("terms_refund", "en")).toThrow();
  });

  it("dice lo mismo que legal-terms (reembolso), los Términos §6 y la FAQ", () => {
    for (const lang of ["en", "es"] as const) {
      const r = refundPolicy.text[lang];
      // Se cobra se venda o no; no reembolsable una vez publicada; reembolso total antes.
      expect(r).toMatch(lang === "en" ? /charged whether or not your home sells/ : /se cobra se venda o no tu propiedad/);
      expect(r).toMatch(lang === "en" ? /non-refundable once your property is published on the MLS/ : /no se reembolsa una vez tu propiedad está publicada en el MLS/);
      expect(r).toMatch(lang === "en" ? /full refund/ : /Te devolvemos el total/);
      expect(r).toMatch(lang === "en" ? /cancel before it's published/ : /cancelas antes de la publicación/);
      // v3: terminación sin costo y comisión solo al cierre; sin tarifa de cancelación.
      expect(r).toMatch(lang === "en" ? /end your listing agreement at any time, at no charge/ : /terminar tu acuerdo de listado en cualquier momento, sin costo/);
      expect(r).not.toMatch(/cancellation fee|tarifa de cancelación/);
      // Los Términos dicen lo mismo; en español, con usted (refundPolicyTerms).
      expect(termsDoc[lang].sections.find((s) => s.heading.startsWith("6."))?.body).toContain(refundPolicyTerms[lang]);
      expect(termsFaq(lang).refund.a).toBe(r);
    }
    // La comisión solo si se vende: también en los Términos §6.
    expect(termsDoc.en.sections.find((s) => s.heading.startsWith("6."))?.body.join(" ")).toMatch(/only if and when your property sells/);
  });

  it("la versión es la de los Términos y el servidor la exige", () => {
    expect(CONSENTS.terms_refund.version).toBe(LEGAL_DOCS.terms.version);
    const route = read("src/app/api/checkout/tier/route.ts");
    expect(route).toContain('body.refund_terms_version !== CONSENTS.terms_refund.version');
    expect(route).toContain("tier,");
    const page = read("src/app/[lang]/listing/new/page.tsx");
    expect(page).toContain('consentCheckbox("terms_refund", lang, draft.pricing_tier)');
  });
});

describe("aceptación de Términos y Privacidad al crear la cuenta (terms)", () => {
  it("texto exacto (desde la v2, con el arbitraje de la §17) y versión que nombra los dos documentos", () => {
    expect(consentFullText("terms", "en")).toBe(
      "I agree to the Terms of Service, including the arbitration agreement in Section 17, and the Privacy Policy.",
    );
    expect(consentFullText("terms", "es")).toBe(
      "Acepto los Términos de servicio, incluido el acuerdo de arbitraje de la Sección 17, y la Política de privacidad.",
    );
    expect(CONSENTS.terms.version).toBe(`terms-${LEGAL_DOCS.terms.version}+privacy-${LEGAL_DOCS.privacy.version}`);
    // v3: cambian los Términos (§6); la Privacidad sigue en la v2.
    expect(CONSENTS.terms.version).toBe("terms-2026-10-21-v3+privacy-2026-10-24-v4");
    expect(CONSENTS.terms.version.length).toBeLessThanOrEqual(64); // check de la columna
    const parts = consentCheckbox("terms", "en");
    expect([parts.link, parts.link2, parts.link3]).toEqual(["Terms of Service", "arbitration agreement in Section 17", "Privacy Policy"]);
    expect(CONSENTS.terms.links).toEqual(["/terms", "/terms#section-17", "/privacy"]);
    // La §17 existe con esa ancla, en EN y ES.
    for (const lang of ["en", "es"] as const) {
      const s17 = termsDoc[lang].sections.find((s) => s.id === "section-17");
      expect(s17?.heading, lang).toMatch(/^17\. /);
      expect(JSON.stringify(s17), lang).toMatch(/arbitra/i);
    }
  });

  it("la v1 sigue reconstruyéndose (las cuentas creadas con ella conservan su prueba)", () => {
    expect(consentFullText("terms", "en", null, "terms-2026-10-18-v1+privacy-2026-10-18-v1")).toBe(
      "I agree to the Terms of Service and Privacy Policy.",
    );
    expect(consentFullText("terms", "es", null, "terms-2026-10-18-v1+privacy-2026-10-18-v1")).toBe(
      "Acepto los Términos de servicio y la Política de privacidad.",
    );
    expect(consentFullText("terms", "en", null, "terms-2026-10-18-v2+privacy-2026-10-18-v2")).toBe(consentFullText("terms", "en"));
    expect(() => consentFullText("terms", "en", null, "no-existe")).toThrow();
  });

  it("la migración admite el documento 'terms'", () => {
    expect(read("supabase/migrations/20261019120000_terms_acceptances.sql")).toContain(
      "check (document in ('terms', 'terms_refund', 'esign', 'calls_sms'))",
    );
  });

  it("/sign-up: sin la casilla no se crea la cuenta; la prueba se registra y, si falla, se borra la cuenta", () => {
    const page = read("src/app/[lang]/sign-up/page.tsx");
    const action = page.slice(page.indexOf("async function signUpAction"));
    expect(action.indexOf("termsAcceptedIn(formData)")).toBeLessThan(action.indexOf("supabase.auth.signUp("));
    expect(action).toContain('document: "terms"');
    expect(action).toContain('context: "signup"');
    expect(action).toContain("auth.admin.deleteUser(created.id)");
    expect(page).toContain("<TermsConsentCheckbox");
  });

  it("paso 7: sin la casilla no se crea la cuenta; la prueba va ANTES de convertir la sesión", () => {
    const page = read("src/app/[lang]/listing/new/page.tsx");
    const action = page.slice(page.indexOf("async function registerAccount"), page.indexOf("async function resendEmailCode"));
    const check = action.indexOf("termsAcceptedIn(formData)");
    const record = action.indexOf('context: "step7_account"');
    expect(check).toBeGreaterThan(0);
    expect(record).toBeGreaterThan(check);
    expect(record).toBeLessThan(action.indexOf("supabase.auth.updateUser("));
    expect(read("src/components/account-gate.tsx")).toContain("<TermsConsentCheckbox");
  });

  it("la casilla es obligatoria (mensaje propio, no la burbuja del navegador) y enlaza a /terms, /terms#section-17 y /privacy", () => {
    const box = read("src/components/terms-consent-checkbox.tsx");
    expect(box).toContain('name="accept_terms"');
    // Sin `required` nativo: el envío se detiene y se muestra requiredMessage en el idioma de la página.
    expect(box).not.toMatch(/^\s*required\s*$/m);
    expect(box).toContain("e.preventDefault()");
    expect(box).toContain("{requiredMessage}");
    expect(box).toContain("CONSENTS.terms.links");
    for (const k of ["parts.link,", "parts.link2,", "parts.link3,"]) expect(box).toContain(k);
  });
});

describe("aviso E-SIGN del paso 7", () => {
  it("lleva el correo de soporte desde brokerage.ts y la casilla", () => {
    for (const lang of ["en", "es"] as const) {
      const n = consentNotice("esign", lang);
      expect(n.join(" ")).toContain(SUPPORT_EMAIL);
      expect(n.join(" ")).not.toMatch(/\{\w+\}/);
    }
    expect(consentCheckbox("esign", "en").before).toBe("I agree to receive and sign these documents electronically.");
    // v2: el consentimiento se retira "en cualquier momento" (sin "antes de firmar").
    expect(CONSENTS.esign.version).toBe("2026-10-18-v2");
    expect(consentNotice("esign", "en")[2]).toBe(
      "You can withdraw this consent at any time by writing to the same address; we'll then arrange paper signing, which may delay your listing. Withdrawing doesn't affect documents you already signed.",
    );
    expect(consentNotice("esign", "es")[2]).toMatch(/^Puedes retirar este consentimiento en cualquier momento escribiendo/);
    for (const lang of ["en", "es"] as const) expect(consentNotice("esign", lang).join(" ")).not.toMatch(/before signing|antes de firmar/);
    expect(consentNotice("esign", "en", "2026-10-18-v1")[2]).toContain("at any time before signing");
    // Paso del embudo: español con tú.
    expect(consentNotice("esign", "es").join(" ")).not.toMatch(/\busted\b|Firmará(?!s)|Puede pedir/);
    const route = read("src/app/api/agreement/create/route.ts");
    expect(route).toContain("body.esign_version !== CONSENTS.esign.version");
  });
});

describe("hashes de los textos publicados", () => {
  it("cada versión registrada, vigente o anterior, se reconstruye con su hash (un texto publicado no se edita)", () => {
    for (const [key, byLang] of Object.entries(PUBLISHED_CONSENT_HASHES)) {
      const [docVer, tier] = key.split(":");
      const [doc, version] = docVer.split("@") as [keyof typeof CONSENTS, string];
      for (const lang of ["en", "es"] as const) {
        expect(consentTextHash(doc, lang, (tier as never) ?? null, version), `${key} ${lang}`).toBe(byLang[lang]);
      }
    }
    // La v1 sigue en la lista: las aceptaciones registradas con ella conservan su prueba.
    for (const k of ["terms@terms-2026-10-18-v1+privacy-2026-10-18-v1", "terms_refund@2026-10-18-v1:pro", "esign@2026-10-18-v1"]) {
      expect(PUBLISHED_CONSENT_HASHES[k], k).toBeDefined();
    }
  });

  it("toda versión vigente tiene hash publicado (por plan, si el texto lo lleva)", () => {
    for (const [doc, def] of Object.entries(CONSENTS)) {
      const keys = def.perPlan ? TIER_ORDER.map((t) => `${doc}@${def.version}:${t}`) : [`${doc}@${def.version}`];
      for (const k of keys) expect(PUBLISHED_CONSENT_HASHES[k], k).toBeDefined();
    }
  });

  it("el texto exacto se reconstruye y no deja marcadores", () => {
    expect(consentFullText("calls_sms", "en")).toContain(BROKERAGE.legalName);
    for (const t of TIER_ORDER) expect(consentFullText("terms_refund", "es", t)).not.toMatch(/\{\w+\}/);
  });
});

describe("textos legales: correos y Términos", () => {
  it("correos legales: constantes en brokerage.ts", () => {
    expect([LEGAL_EMAIL, PRIVACY_EMAIL, NOTICES_EMAIL, DMCA_EMAIL]).toEqual([
      "legal@lixtara.com",
      "privacy@lixtara.com",
      "notices@lixtara.com",
      "dmca@lixtara.com",
    ]);
    expect(CONTACT_EMAIL).toBe("camilo@lixtara.com");
  });

  it("ningún texto escribe un correo de lixtara.com a mano", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !n.includes(".test.") ? [p] : [];
      });
    // brokerage.ts y contact.ts definen los buzones; dmca-agent.ts guarda el contacto
    // administrativo tal como quedó en el registro de la Copyright Office (no se publica).
    const ALLOWED = new Set(["src/config/brokerage.ts", "src/config/contact.ts"]);
    const offenders: string[] = [];
    for (const f of walk(join(ROOT, "src"))) {
      const rel = relative(ROOT, f);
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
      for (const m of text.matchAll(/[a-z0-9._-]+@lixtara\.com/g)) {
        if (rel === "src/lib/legal/dmca-agent.ts" && m[0] === "camilo@lixtara.com") continue;
        offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("Términos: jerarquía de acuerdos (§1) y arbitraje sin arbitraje masivo (§17)", () => {
    const en = termsDoc.en.sections;
    expect(en[0].body.join(" ")).toContain(
      "If these Terms conflict with a listing agreement, buyer agreement, or any other brokerage agreement you sign with Lixtara LLC, that agreement controls.",
    );
    const arb = en.find((s) => s.heading.startsWith("17."))!;
    expect(arb.heading).toBe("17. Dispute Resolution; Arbitration; Class Action Waiver");
    expect(arb.body).toEqual([
      "(a) Except for Excluded Claims, you and Lixtara LLC agree that any dispute arising out of or relating to these Terms or your use of the Services will be resolved by binding individual arbitration administered by the American Arbitration Association under its Consumer Arbitration Rules. The Federal Arbitration Act governs this Section.",
      "(b) Excluded Claims: (i) individual claims within the jurisdiction of a small claims court; (ii) disputes arising under a listing agreement, buyer agreement or other brokerage agreement, which are governed by that agreement; (iii) complaints to the Florida Department of Business and Professional Regulation, the Florida Real Estate Commission or any other government agency.",
      "(c) Claims may be brought only in an individual capacity, not as a plaintiff or class member in any class, collective or representative proceeding.",
      `(d) You may opt out of this Section within thirty (30) days after you first accept these Terms by emailing ${LEGAL_EMAIL} with your name and a statement that you opt out of arbitration.`,
      "(e) If the class action waiver is found unenforceable as to any claim, that claim will proceed in the state or federal courts located in Miami-Dade County, Florida.",
      "(f) These Terms are governed by Florida law, except that the Federal Arbitration Act governs this Section.",
    ]);
    for (const lang of ["en", "es"] as const) {
      const all = JSON.stringify(termsDoc[lang]);
      expect(all, lang).not.toMatch(/mass arbitration|batch|bellwether|arbitraje masivo|por lotes/i);
      expect(all, lang).not.toMatch(/may not consolidate|no podrá consolidar/i);
    }
    const es = termsDoc.es.sections.find((s) => s.heading.startsWith("17."))!;
    expect(es.body).toHaveLength(6);
    expect(es.body[3]).toContain(LEGAL_EMAIL);
    expect(es.body.join(" ")).toMatch(/\busted\b/);
  });

  it("Privacidad: prueba del consentimiento (fecha, IP, user agent, versión; 5 años)", () => {
    for (const lang of ["en", "es"] as const) {
      const sub = privacyDoc[lang].sections.flatMap((s) => s.sub ?? []).find((s) => s.heading.startsWith("7.1"))!;
      const body = sub.body.join(" ");
      for (const re of lang === "en"
        ? [/date and time/, /IP address/, /user agent/, /version of the text/, /only to document your consent and to defend against claims/, /five \(5\) years after our relationship with you ends/]
        : [/fecha y la hora/, /dirección IP/, /agente de usuario/, /versión del texto/, /únicamente para documentar su consentimiento y para defendernos de reclamaciones/, /cinco \(5\) años después de que termine nuestra relación/]) {
        expect(body, `${lang} ${re}`).toMatch(re);
      }
    }
  });

  it("Privacidad y Avisos legales nombran a Lixtara LLC con su dirección", () => {
    for (const doc of [privacyDoc, disclaimersDoc]) {
      for (const lang of ["en", "es"] as const) {
        const all = JSON.stringify(fillLegalDoc(doc[lang]));
        expect(all, lang).toContain(BROKERAGE.legalName);
        expect(all, lang).toContain(BROKERAGE.address);
        expect(all, lang).not.toMatch(/operated by Lixtara[.,]|operada por Lixtara[.,]/);
      }
    }
  });
});
