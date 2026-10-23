import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  BUYER_COMP_TERMS_VERSION,
  LEGAL_TERMS,
  PUBLICATION_BUSINESS_DAYS,
  buyerAgentComp,
  publicationTimeline,
  refundPolicy,
  termsFaq,
  type LegalTermKey,
} from "@/config/legal-terms";

// Hash de los textos (EN+ES) de cada definición en su versión vigente. Si cambias un texto,
// sube su `version` y actualiza aquí el hash: así ninguna definición cambia sin versión nueva.
const PINNED: Record<LegalTermKey, { version: string; sha256: string }> = {
  lixtaraCharges: { version: "1", sha256: "ee4f31c33eb9fe35a00e93dfe6dd48516839216a6de59499469df9ac06879c51" },
  buyerAgentComp: { version: "3", sha256: "1c5daa79ac688d6a5bcc7075a94f97fbff819d62bcb31e2159d6bb7c29a1e724" },
  publicationTimeline: { version: "1", sha256: "64480052320a494b9837bf751f9c6fb2892675c03c07fe5b14607da58ddcbee2" },
  refundPolicy: { version: "3", sha256: "24ea828e1bd35a2a0f4c62e23ebc955f6c829a6f1c1b9229c87cff976db97a3d" },
  listingTermination: { version: "1", sha256: "7f0472c54c05e228276c584c74eeb241451ff1fca297a96125e97dcb750830dc" },
  legalServices: { version: "1", sha256: "3a64942c4dd2db6499e71e2c1de8f95445c3ce89395266a621f5be81df9b5d4e" },
  propertyAccess: { version: "1", sha256: "9f0988ee95d2164da9103bdc4d0d0e70e5c13020a18f7fa92bd03034850cb549" },
  servicesNotProvided: { version: "1", sha256: "b9ae51f78419a7e306e568d33a2ae02e11bf08f37b9b9244ca02688be5a0639e" },
};

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const keys = (o: object): string[] => Object.keys(o).sort();

describe("legal-terms: versiones", () => {
  it.each(Object.keys(LEGAL_TERMS) as LegalTermKey[])("%s: el texto no cambia sin subir la versión", (k) => {
    const def = LEGAL_TERMS[k];
    expect(def.version, k).toBe(PINNED[k].version);
    expect(hash(def.text), `${k}: sube la versión y actualiza el hash`).toBe(PINNED[k].sha256);
  });

  it("cada definición tiene fecha válida", () => {
    for (const [k, def] of Object.entries(LEGAL_TERMS)) expect(def.date, k).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("la versión guardada con la oferta sigue a la definición", () => {
    expect(BUYER_COMP_TERMS_VERSION).toBe(`buyer_agent_comp@${buyerAgentComp.version}`);
    expect(BUYER_COMP_TERMS_VERSION.length).toBeLessThanOrEqual(64);
  });
});

describe("legal-terms: EN/ES", () => {
  it("las mismas claves en los dos idiomas", () => {
    for (const [k, def] of Object.entries(LEGAL_TERMS)) {
      if (typeof def.text.en === "string") expect(typeof def.text.es, k).toBe("string");
      else expect(keys(def.text.es as object), k).toEqual(keys(def.text.en as object));
    }
    expect(keys(termsFaq("es"))).toEqual(keys(termsFaq("en")));
  });

  it("español con tú, nunca usted; decimales con punto", () => {
    const es = JSON.stringify([Object.values(LEGAL_TERMS).map((d) => d.text.es), termsFaq("es")]);
    expect(es).not.toMatch(/\busted(es)?\b/i);
    expect(es).not.toMatch(/\d,\d+ ?%/);
  });
});

describe("legal-terms: contenido aprobado", () => {
  it("plazo: 2 días hábiles desde el acuerdo firmado y el material completo", () => {
    expect(PUBLICATION_BUSINESS_DAYS).toBe(2);
    expect(publicationTimeline.text.es.phrase).toBe(
      "dentro de 2 días hábiles desde que el acuerdo esté firmado y tengamos fotos, datos y documentos completos",
    );
    expect(publicationTimeline.text.en.phrase).toMatch(/^within 2 business days once your agreement is signed and we have your complete photos, details and documents$/);
    const all = JSON.stringify(publicationTimeline.text);
    expect(all).not.toMatch(/48|hours|horas|after signing|tras la firma/i);
  });

  it("paso 6: encabezado y subtexto exactos en español", () => {
    expect(buyerAgentComp.text.es.stepTitle).toBe("¿Quieres ofrecer compensación al agente del comprador?");
    expect(buyerAgentComp.text.en.stepTitle).toBe("Do you want to offer compensation to the buyer's agent?");
    expect(buyerAgentComp.text.es.stepBody).toBe(
      "Puedes ofrecer pagar, total o parcialmente, la compensación del agente que represente al comprador, o no ofrecer ninguna. Esta compensación es aparte de la comisión de Lixtara. Desde 2024, por las reglas del MLS, esta oferta no se publica en el MLS: si decides hacerla, la comunicaremos directamente a los agentes que la soliciten. Es 100% negociable, no la fija la ley y quedará formalizada por escrito.",
    );
    expect(buyerAgentComp.text.es.noticeOffer).toBe(
      "Ofrecer compensación puede hacer tu propiedad más atractiva para los agentes que trabajan con compradores.",
    );
    expect(buyerAgentComp.text.es.noticeNoOffer).toBe(
      "Muchos compradores trabajan con un agente al que se comprometieron por escrito a pagar. Si no ofreces compensación, el comprador puede pagarle directamente a su agente o pedirte que la cubras como parte de su oferta. Tú decides si aceptas.",
    );
    expect(buyerAgentComp.text.es.conciergeSuggested).toBe("Punto de partida sugerido por tu broker; puedes cambiarlo");
    expect(buyerAgentComp.text.en.conciergeSuggested).toBe("Suggested starting point from your broker; you can change it");
  });

  it("reembolso: no reembolsable solo una vez publicada; los cuatro casos de reembolso total", () => {
    for (const lang of ["en", "es"] as const) {
      const r = refundPolicy.text[lang];
      expect(r, lang).toMatch(lang === "en" ? /once your property is published on the MLS/ : /una vez tu propiedad está publicada en el MLS/);
      for (const re of lang === "en"
        ? [/doesn't approve/, /can't be published/, /charged twice/, /technical error/, /cancel before/]
        : [/no aprueba/, /no se puede publicar/, /dos veces/, /error técnico/, /cancelas antes/]) {
        expect(r, `${lang} ${re}`).toMatch(re);
      }
    }
  });
});
