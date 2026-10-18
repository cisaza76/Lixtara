// Glosario fijo EN/ES. Cada término tiene UNA forma aprobada por idioma; las variantes de
// `forbidden` no pueden aparecer en ningún texto del sitio (src/config/glossary.test.ts recorre
// los diccionarios, los términos legales, los correos y el prompt de Loui).
//
// "broker" se queda igual en español: Anamaria es la broker, nunca "corredora" ni "agente".
// ("corredor hipotecario" es otra profesión, el mortgage broker, y sí se permite.)

type Lang = "en" | "es";

export interface GlossaryTerm {
  en: string;
  es: string;
  forbidden: Record<Lang, RegExp[]>;
}

export const GLOSSARY = {
  buyerAgentComp: {
    en: "buyer's agent compensation",
    es: "compensación al agente del comprador",
    forbidden: {
      en: [/\bbuyer'?s? commission\b/i, /\bbuyer[- ]agent commission\b/i, /\bbuyer's agent commission\b/i, /\bco-?op(erating)? commission\b/i],
      es: [/comisi[oó]n del comprador/i, /comisi[oó]n (del|al) agente (del )?comprador/i, /\bagente comprador\b/i],
    },
  },
  lixtaraCommission: {
    en: "Lixtara commission",
    es: "comisión de Lixtara",
    forbidden: {
      en: [/\bLixtara fee\b/i, /\bLixtara's fee\b/i],
      es: [/honorarios de Lixtara/i, /\bcomisi[oó]n Lixtara\b/i, /\btarifa de Lixtara\b/i],
    },
  },
  flatFee: {
    en: "flat fee",
    es: "tarifa fija",
    forbidden: {
      en: [/\blisting fee\b/i, /\bsubscription\b/i],
      es: [/tarifa plana/i, /cuota fija/i, /tarifa de listing/i, /\bsuscripci[oó]n\b/i, /\bflat fee\b/i],
    },
  },
  publishedOnMls: {
    en: "published on the MLS",
    es: "publicado en el MLS",
    forbidden: {
      en: [/\blive on (the )?MLS\b/i],
      es: [/\ben vivo en (el )?MLS\b/i, /\blive en (el )?MLS\b/i],
    },
  },
  listingAgreement: {
    en: "listing agreement",
    es: "acuerdo de listado",
    forbidden: {
      en: [/\blisting contract\b/i],
      es: [/\blisting agreement\b/i, /acuerdo de listing/i, /contrato de listado/i, /contrato de listing/i],
    },
  },
  broker: {
    en: "broker",
    es: "broker",
    forbidden: {
      en: [/\bour agent\b/i],
      es: [/\bcorredor(a|es|as)?\b(?! hipotecari)/i, /\bnuestr[oa] agente\b/i],
    },
  },
  seller: {
    en: "seller",
    es: "vendedor",
    forbidden: {
      en: [],
      es: [/\bel seller\b/i, /\bpropietario vendedor\b/i],
    },
  },
  closing: {
    en: "closing",
    es: "cierre",
    forbidden: {
      en: [],
      es: [/\b(el|al|del) closing\b/i],
    },
  },
} as const satisfies Record<string, GlossaryTerm>;

export type GlossaryKey = keyof typeof GLOSSARY;

/** Término aprobado. */
export function term(key: GlossaryKey, lang: Lang): string {
  return GLOSSARY[key][lang];
}

/** Variantes no aprobadas que aparecen en `text` (vacío = cumple el glosario). */
export function glossaryViolations(text: string, lang: Lang): { key: GlossaryKey; match: string }[] {
  const out: { key: GlossaryKey; match: string }[] = [];
  for (const key of Object.keys(GLOSSARY) as GlossaryKey[]) {
    for (const re of GLOSSARY[key].forbidden[lang]) {
      const m = text.match(re);
      if (m) out.push({ key, match: m[0] });
    }
  }
  return out;
}
