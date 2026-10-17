// Coherencia legal en todo el sitio (instrucción del 2026-10-16, Tarea 3). Falla si:
//   - falta una página legal o un idioma;
//   - cambia un precio, un porcentaje o un plazo sin publicar una versión nueva de los Términos;
//   - se edita un texto de consentimiento ya versionado (su prueba dejaría de coincidir);
//   - el marketing, Loui o los correos vuelven a prometer algo que los Términos no dicen;
//   - el pie de página pierde un enlace legal, la línea de licencia o Equal Housing.
// (La línea de licencia escrita a mano la cubre src/config/brokerage.test.ts; los proveedores
// de la política de privacidad, src/lib/legal/providers.test.ts; pagar sin la casilla,
// src/app/api/checkout/tier/route.test.ts.)
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PHOTOGRAPHY_ADDON_PRICE, PRICING_TIERS } from "@/lib/pricing-tiers";
import { STAGING_FREE_QUOTA, STAGING_OVERAGE_PRICE } from "@/lib/staging";
import { t } from "@/lib/i18n";
import { LEGAL_DOCS, PUBLICATION_BUSINESS_DAYS, TERMS_PRICING_SNAPSHOT, fillLegalDoc, type LegalDocId } from "./config";
import { CONSENTS, PUBLISHED_CONSENT_HASHES } from "./consents";
import { consentTextHash } from "./consents.server";
import { termsDoc } from "./terms";
import { privacyDoc } from "./privacy";
import { cookiesDocFor } from "./cookies";
import { disclaimersDoc } from "./disclaimers";
import { noticesDoc } from "./notices";
import { accessibilityDoc } from "./accessibility";
import { dmcaDoc } from "./dmca";
import type { LegalDoc } from "./types";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const DOCS: Record<LegalDocId, (lang: "en" | "es") => LegalDoc> = {
  terms: (l) => termsDoc[l],
  privacy: (l) => privacyDoc[l],
  cookies: (l) => cookiesDocFor(l, { gtm: true, posthog: false }),
  disclaimers: (l) => disclaimersDoc[l],
  notices: (l) => noticesDoc[l],
  accessibility: (l) => accessibilityDoc[l],
  dmca: (l) => dmcaDoc[l],
};

describe("páginas legales: todas, en los dos idiomas, desde una sola configuración", () => {
  it.each(Object.keys(LEGAL_DOCS) as LegalDocId[])("%s: página, fecha, versión y contenido EN/ES", (id) => {
    const meta = LEGAL_DOCS[id];
    const page = `src/app/[lang]${meta.path}/page.tsx`;
    expect(existsSync(join(root, page)), page).toBe(true);
    expect(read(page)).toContain(`docId="${id}"`);
    expect(meta.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.version.length).toBeGreaterThan(0);
    for (const lang of ["en", "es"] as const) {
      const doc = fillLegalDoc(DOCS[id](lang));
      expect(doc.title, `${id} ${lang}`).toBeTruthy();
      expect(doc.sections.length, `${id} ${lang}`).toBeGreaterThan(0);
      expect(JSON.stringify(doc), `${id} ${lang}: marcador sin reemplazar`).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });

  it("ninguna página usa una fecha escrita a mano", () => {
    for (const id of Object.keys(LEGAL_DOCS)) {
      expect(read(`src/app/[lang]${LEGAL_DOCS[id as LegalDocId].path}/page.tsx`)).not.toMatch(/updatedOn=|\d{4}-\d{2}-\d{2}/);
    }
  });
});

describe("precios y plazos: no cambian sin una versión nueva de los Términos", () => {
  it("la foto de precios corresponde a la versión vigente de los Términos", () => {
    expect(TERMS_PRICING_SNAPSHOT.termsVersion).toBe(LEGAL_DOCS.terms.version);
  });

  it("los precios, porcentajes y plazos actuales son los de esa versión", () => {
    const now = {
      tiers: Object.fromEntries(
        Object.entries(PRICING_TIERS).map(([id, t]) => [
          id,
          { flatFee: t.flatFee, commissionPct: t.commissionPct, termMonths: t.termMonths, includesPhotography: t.includesPhotography },
        ]),
      ),
      photoAddonPrice: PHOTOGRAPHY_ADDON_PRICE,
      stagingFreeQuota: STAGING_FREE_QUOTA,
      stagingOveragePrice: STAGING_OVERAGE_PRICE,
      publicationBusinessDays: PUBLICATION_BUSINESS_DAYS,
    };
    const { termsVersion: _v, ...snapshot } = TERMS_PRICING_SNAPSHOT;
    expect(
      now,
      "Cambió un precio o un plazo: publique una versión nueva de los Términos (LEGAL_DOCS.terms) y actualice TERMS_PRICING_SNAPSHOT",
    ).toEqual(snapshot);
  });

  it("la casilla del paso 8 usa la versión vigente de los Términos", () => {
    expect(CONSENTS.terms_refund.version).toBe(LEGAL_DOCS.terms.version);
  });
});

describe("textos de consentimiento: lo registrado se puede reconstruir", () => {
  it.each(Object.keys(CONSENTS) as Array<keyof typeof CONSENTS>)("%s: la versión vigente tiene su hash fijado y coincide", (doc) => {
    const key = `${doc}@${CONSENTS[doc].version}`;
    const pinned = PUBLISHED_CONSENT_HASHES[key];
    expect(pinned, `falta ${key} en PUBLISHED_CONSENT_HASHES`).toBeDefined();
    for (const lang of ["en", "es"] as const) {
      expect(consentTextHash(doc, lang), `${key} ${lang}: el texto cambió sin cambiar la versión`).toBe(pinned![lang]);
    }
  });

  it("los textos de la casilla del paso 8 son los aprobados", () => {
    const full = (l: "en" | "es") => {
      const c = CONSENTS.terms_refund.checkbox[l];
      return `${c.before}${c.link ?? ""}${c.after ?? ""}`;
    };
    expect(full("es")).toBe(
      "Entiendo que la tarifa no es reembolsable una vez mi listing esté publicado en el MLS, salvo las excepciones de los Términos.",
    );
    expect(full("en")).toBe(
      "I understand that the fee is non-refundable once my listing is published on the MLS, except as provided in the Terms.",
    );
  });

  it("los Términos tienen las anclas a las que enlazan la casilla y el recibo", () => {
    for (const lang of ["en", "es"] as const) {
      const ids = JSON.stringify(termsDoc[lang]);
      for (const id of ["refunds", "fees", "term"]) expect(ids, `${lang} #${id}`).toContain(`"id":"${id}"`);
    }
  });
});

describe("nada contradice los Términos: marketing, Loui y correos", () => {
  const dict = JSON.stringify([t("en"), t("es")]);
  it.each([
    ["Cancel anytime"],
    ["Cancela cuando quieras"],
    ["live within 48h"],
    ["activa en 48h"],
    ["go live within 48 hours"],
    ["salen en 48 horas"],
    ["published with your MLS listing"],
    ["se publica con tu listado en el MLS"],
    ["with no penalty"],
    ["sin penalidad"],
    ["the longest in the industry"],
    ["en máximo un día hábil"],
  ])("el sitio no dice «%s»", (phrase) => {
    expect(dict).not.toContain(phrase);
  });

  it("Loui no se atribuye licencias ni promete plazos distintos", () => {
    const loui = read("src/lib/loui-prompt.ts");
    expect(loui).not.toMatch(/PhD|holding both a Realtor and Broker license|within 48 hours/);
    expect(loui).toContain("${PUBLICATION_BUSINESS_DAYS} business days");
  });

  it("el correo de aprobación no promete cuándo aparece en los portales", () => {
    expect(read("src/lib/email.ts")).not.toMatch(/within the next few hours|en las próximas horas/);
  });
});

describe("pie de página", () => {
  const layout = read("src/app/[lang]/layout.tsx");
  it("enlaza todas las páginas legales, con su texto en EN y ES", () => {
    for (const id of Object.keys(LEGAL_DOCS)) {
      expect(layout, id).toMatch(new RegExp(`LEGAL_FOOTER_ORDER[^\\n]*"${id}"`));
      for (const lang of ["en", "es"] as const) {
        expect((t(lang).footer.links as Record<string, string>)[id], `${lang} ${id}`).toBeTruthy();
      }
    }
  });
  it("línea de licencia, Licensed Real Estate Brokerage y Equal Housing Opportunity con logo", () => {
    expect(layout).toContain("brokerageLicenseLine(lang)");
    expect(layout).toContain("footerCopy.licensedBrokerage");
    expect(layout).toContain("<EqualHousingLogo");
    expect(layout).toContain("{BROKERAGE.legalName}");
  });
});
