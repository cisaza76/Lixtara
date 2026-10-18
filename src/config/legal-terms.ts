// Fuente única de los términos que el sitio promete al vendedor: qué cobra Lixtara, la
// compensación al agente del comprador, el plazo de publicación, el reembolso, los servicios
// legales, el acceso a propiedades y lo que Lixtara no presta. Planes, paso 6, paso 8, FAQ,
// Términos, Avisos, Loui, correos y recibos leen de aquí; nadie redacta estos textos aparte.
//
// Decisiones del owner y de la broker (2026-10-17). Cada definición lleva versión y fecha:
// si cambia un texto, cambia su versión (src/config/legal-terms.test.ts fija el hash de cada
// versión y falla si el texto cambia sin subirla). La versión de la compensación se guarda
// con la oferta del vendedor (properties.buyer_agent_comp_terms_version).

import { legalFaqAnswer, legalServicesDisclosure } from "@/config/legalPartner";
import { BUYER_COMP_MAX_PCT } from "@/lib/buyer-comp";
import { PRICING_TIERS, TIER_ORDER } from "@/lib/pricing-tiers";

type Lang = "en" | "es";

/** Plazo de publicación en el MLS, en días hábiles (America/New_York). */
export const PUBLICATION_BUSINESS_DAYS = 2;

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const fees = () => TIER_ORDER.map((id) => `${usd(PRICING_TIERS[id].flatFee)} ${tierName(id)}`).join(", ");
const pcts = (lang: Lang) => {
  const list = TIER_ORDER.map((id) => `${PRICING_TIERS[id].commissionPct}%`);
  return `${list.slice(0, -1).join(", ")} ${lang === "es" ? "o" : "or"} ${list[list.length - 1]}`;
};
function tierName(id: (typeof TIER_ORDER)[number]): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export interface TermDefinition<T> {
  /** Sube con cualquier cambio de texto. */
  version: string;
  /** Fecha de la versión (YYYY-MM-DD, America/New_York). */
  date: string;
  text: Record<Lang, T>;
}

// ── 1. Lo que cobra Lixtara ────────────────────────────────────────────────────────
export const lixtaraCharges: TermDefinition<string> = {
  version: "1",
  date: "2026-10-17",
  text: {
    en: `Lixtara charges a flat fee when you list (${fees()}) and the Lixtara commission at closing, only if your home sells (${pcts("en")} of the sale price, depending on your plan).`,
    es: `Lixtara cobra una tarifa fija al publicar (${fees()}) y la comisión de Lixtara al cierre, solo si tu propiedad se vende (${pcts("es")} del precio de venta, según tu plan).`,
  },
};

// ── 2. Compensación al agente del comprador ──────────────────────────────────────────
export interface BuyerCompTexts {
  /** Resumen (Términos §4.1, Loui). Incluye `cap`. */
  summary: string;
  /** Tope por política de Lixtara (BUYER_COMP_MAX_PCT): Términos, FAQ y Loui. */
  cap: string;
  /** Paso 6. */
  stepTitle: string;
  stepBody: string;
  noticeOffer: string;
  noticeNoOffer: string;
  conciergeSuggested: string;
  /** Debajo de los planes. */
  planNote: string;
  /** Ficha pública: la oferta no se muestra, se pide a la broker. */
  publicNote: string;
}

// v2 (2026-10-18): el tope de 3% por política de Lixtara entra en el texto (Términos §4.1 y
// FAQ dicen lo mismo) y la ficha pública remite a "la broker".
const BUYER_COMP_CAP: Record<Lang, string> = {
  en: `By Lixtara policy, it can be up to ${BUYER_COMP_MAX_PCT}%: as a percentage of the sale price, or as a fixed amount of up to ${BUYER_COMP_MAX_PCT}% of the list price.`,
  es: `Por política de Lixtara, puede ser de hasta ${BUYER_COMP_MAX_PCT}%: como porcentaje del precio de venta, o como monto fijo de hasta el ${BUYER_COMP_MAX_PCT}% del precio de lista.`,
};

export const buyerAgentComp: TermDefinition<BuyerCompTexts> = {
  version: "2",
  date: "2026-10-18",
  text: {
    en: {
      summary: `Buyer's agent compensation is separate from the Lixtara commission. You decide whether to offer it and how much, and 0% is allowed. ${BUYER_COMP_CAP.en} Since 2024, MLS rules don't allow it to be published on the MLS, so if you offer it we share it directly with the agents who ask for it. Within that limit it's negotiable, isn't set by law, and is put in writing.`,
      cap: BUYER_COMP_CAP.en,
      stepTitle: "Do you want to offer compensation to the buyer's agent?",
      stepBody:
        "You can offer to pay all or part of the compensation of the agent who represents the buyer, or offer none. This compensation is separate from the Lixtara commission. Since 2024, MLS rules don't allow this offer to be published on the MLS: if you make one, we'll share it directly with the agents who ask for it. It's 100% negotiable, isn't set by law, and will be put in writing.",
      noticeOffer: "Offering compensation can make your property more attractive to agents who work with buyers.",
      noticeNoOffer:
        "Many buyers work with an agent they've agreed in writing to pay. If you don't offer compensation, the buyer can pay their agent directly or ask you to cover it as part of their offer. It's up to you whether to accept.",
      conciergeSuggested: "Suggested starting point from your broker; you can change it",
      planNote:
        "Buyer's agent compensation is separate from every plan and from the Lixtara commission: you decide whether to offer it, and 0% is allowed.",
      publicNote: "Buyer's agent compensation: ask the broker",
    },
    es: {
      summary: `La compensación al agente del comprador es aparte de la comisión de Lixtara. Tú decides si la ofreces y cuánto, y puedes ofrecer 0%. ${BUYER_COMP_CAP.es} Desde 2024, por las reglas del MLS, no se publica en el MLS: si la ofreces, la comunicamos directamente a los agentes que la soliciten. Dentro de ese límite es negociable, no la fija la ley y se formaliza por escrito.`,
      cap: BUYER_COMP_CAP.es,
      stepTitle: "¿Quieres ofrecer compensación al agente del comprador?",
      stepBody:
        "Puedes ofrecer pagar, total o parcialmente, la compensación del agente que represente al comprador, o no ofrecer ninguna. Esta compensación es aparte de la comisión de Lixtara. Desde 2024, por las reglas del MLS, esta oferta no se publica en el MLS: si decides hacerla, la comunicaremos directamente a los agentes que la soliciten. Es 100% negociable, no la fija la ley y quedará formalizada por escrito.",
      noticeOffer: "Ofrecer compensación puede hacer tu propiedad más atractiva para los agentes que trabajan con compradores.",
      noticeNoOffer:
        "Muchos compradores trabajan con un agente al que se comprometieron por escrito a pagar. Si no ofreces compensación, el comprador puede pagarle directamente a su agente o pedirte que la cubras como parte de su oferta. Tú decides si aceptas.",
      conciergeSuggested: "Punto de partida sugerido por tu broker; puedes cambiarlo",
      planNote:
        "La compensación al agente del comprador es aparte de todos los planes y de la comisión de Lixtara: tú decides si la ofreces, y puedes ofrecer 0%.",
      publicNote: "Compensación al agente del comprador: consúltala con la broker",
    },
  },
};

// ── 3. Plazo de publicación ─────────────────────────────────────────────────────────
export interface PublicationTexts {
  /** "dentro de 2 días hábiles desde que…" (para insertar en otra frase). */
  phrase: string;
  /** Frase completa. */
  sentence: string;
  /** Bullet de los planes. */
  planBullet: string;
}

export const publicationTimeline: TermDefinition<PublicationTexts> = {
  version: "1",
  date: "2026-10-17",
  text: {
    en: {
      phrase: `within ${PUBLICATION_BUSINESS_DAYS} business days once your agreement is signed and we have your complete photos, details and documents`,
      sentence: `We publish your property on the MLS within ${PUBLICATION_BUSINESS_DAYS} business days once your agreement is signed and we have your complete photos, details and documents.`,
      planBullet: `Published on the MLS within ${PUBLICATION_BUSINESS_DAYS} business days once your agreement is signed and your photos, details and documents are complete`,
    },
    es: {
      phrase: `dentro de ${PUBLICATION_BUSINESS_DAYS} días hábiles desde que el acuerdo esté firmado y tengamos fotos, datos y documentos completos`,
      sentence: `Publicamos tu propiedad en el MLS dentro de ${PUBLICATION_BUSINESS_DAYS} días hábiles desde que el acuerdo esté firmado y tengamos fotos, datos y documentos completos.`,
      planBullet: `Publicada en el MLS dentro de ${PUBLICATION_BUSINESS_DAYS} días hábiles desde que el acuerdo esté firmado y tengamos fotos, datos y documentos completos`,
    },
  },
};

// ── 4. Política de reembolso ────────────────────────────────────────────────────────
export const refundPolicy: TermDefinition<string> = {
  version: "1",
  date: "2026-10-17",
  text: {
    en: "The flat fee is non-refundable once your property is published on the MLS. You get a full refund if the broker doesn't approve your listing or it can't be published, if you were charged twice or because of a technical error, or if you cancel before it's published.",
    es: "La tarifa fija no se reembolsa una vez tu propiedad está publicada en el MLS. Te devolvemos el total si la broker no aprueba tu listado o no se puede publicar, si te cobramos dos veces o por un error técnico, o si cancelas antes de la publicación.",
  },
};

// ── 5. Servicios legales (texto en legalPartner.ts) ─────────────────────────────────
export const legalServices: TermDefinition<string> = {
  version: "1",
  date: "2026-10-17",
  text: { en: legalServicesDisclosure("en"), es: legalServicesDisclosure("es") },
};

// ── 6. Acceso a propiedades ─────────────────────────────────────────────────────────
export const propertyAccess: TermDefinition<string> = {
  version: "1",
  date: "2026-10-17",
  text: {
    en: "Lixtara doesn't offer access to properties before they're on the MLS. Our listings are published on the MLS for everyone at the same time.",
    es: "Lixtara no ofrece acceso a propiedades antes de que salgan al MLS. Publicamos nuestros listados en el MLS para todos al mismo tiempo.",
  },
};

// ── 7. Servicios que Lixtara NO presta ──────────────────────────────────────────────
export const servicesNotProvided: TermDefinition<string> = {
  version: "1",
  date: "2026-10-17",
  text: {
    en: "Lixtara doesn't search or verify property titles, doesn't provide closing or title company services, and doesn't publish listings on sites outside its actual syndication list.",
    es: "Lixtara no busca ni verifica títulos de propiedad, no presta servicios de cierre ni de compañía de títulos, y no publica listados en sitios que no estén en su lista real de sindicación.",
  },
};

/** Todas las definiciones (tests de versión y paridad). */
export const LEGAL_TERMS = {
  lixtaraCharges,
  buyerAgentComp,
  publicationTimeline,
  refundPolicy,
  legalServices,
  propertyAccess,
  servicesNotProvided,
} as const;

export type LegalTermKey = keyof typeof LEGAL_TERMS;

/** Lo que se guarda con la oferta del vendedor: "buyer_agent_comp@2". */
export const BUYER_COMP_TERMS_VERSION = `buyer_agent_comp@${buyerAgentComp.version}`;

// ── FAQ ─────────────────────────────────────────────────────────────────────────────
export interface FaqItem {
  q: string;
  a: string;
}

/** Preguntas de la FAQ cuyas respuestas salen de esta configuración. */
export function termsFaq(lang: Lang) {
  const comp = buyerAgentComp.text[lang];
  const pub = publicationTimeline.text[lang];
  if (lang === "es") {
    return {
      total: {
        q: "¿Cuánto pago en total?",
        a: `Son hasta tres partes y solo la primera se paga al inicio. ${lixtaraCharges.text.es} Además, la compensación al agente del comprador, solo si decides ofrecerla: es aparte de la comisión de Lixtara y puede ser 0%. Los costos de cierre de terceros (título, depósito en garantía e impuestos de transferencia) son iguales con cualquier brokerage.`,
      },
      mustOffer: {
        q: "¿Tengo que ofrecer compensación al agente del comprador?",
        a: `No. Es tu decisión y 0% es una opción válida. ${comp.cap} ${comp.noticeNoOffer} ${comp.noticeOffer} Dentro de ese límite es negociable y no la fija la ley.`,
      },
      notOnMls: {
        q: "¿Por qué la compensación no aparece en el MLS?",
        a: "Desde 2024, por las reglas del MLS, las ofertas de compensación al agente del comprador no se publican en el MLS. Si decides ofrecerla, la comunicamos directamente a los agentes que la soliciten y queda formalizada por escrito.",
      },
      whenPublished: {
        q: "¿Cuándo se publica mi propiedad?",
        a: `${pub.sentence} Antes, la broker revisa tu listado. Desde el MLS, tu propiedad se distribuye a portales como Zillow, Realtor.com, Redfin y Trulia; cada portal decide cuándo y cómo la muestra.`,
      },
      refund: {
        q: "¿Me devuelven el dinero si cambio de opinión?",
        a: refundPolicy.text.es,
      },
      legal: {
        q: "¿Lixtara me da asesoría legal?",
        a: legalFaqAnswer("es"),
      },
      earlyAccess: {
        q: "¿Puedo ver propiedades antes de que salgan al MLS?",
        a: `No. ${propertyAccess.text.es} Si buscas casa, la broker te acompaña desde que una propiedad está publicada.`,
      },
    } satisfies Record<string, FaqItem>;
  }
  return {
    total: {
      q: "How much do I pay in total?",
      a: `Up to three parts, and only the first is paid upfront. ${lixtaraCharges.text.en} On top of that, buyer's agent compensation, only if you choose to offer it: it's separate from the Lixtara commission and can be 0%. Third-party closing costs (title, escrow and transfer taxes) are the same with any brokerage.`,
    },
    mustOffer: {
      q: "Do I have to offer compensation to the buyer's agent?",
      a: `No. It's your decision, and 0% is a valid choice. ${comp.cap} ${comp.noticeNoOffer} ${comp.noticeOffer} Within that limit it's negotiable and isn't set by law.`,
    },
    notOnMls: {
      q: "Why doesn't the buyer's agent compensation appear on the MLS?",
      a: "Since 2024, MLS rules don't allow offers of compensation to buyer's agents to be published on the MLS. If you choose to offer it, we share it directly with the agents who ask for it, and it's put in writing.",
    },
    whenPublished: {
      q: "When is my property published?",
      a: `${pub.sentence} Before that, the broker reviews your listing. From the MLS your home is syndicated to portals like Zillow, Realtor.com, Redfin and Trulia; each portal decides when and how it shows it.`,
    },
    refund: {
      q: "Do I get my money back if I change my mind?",
      a: refundPolicy.text.en,
    },
    legal: {
      q: "Does Lixtara give legal advice?",
      a: legalFaqAnswer("en"),
    },
    earlyAccess: {
      q: "Can I see properties before they hit the MLS?",
      a: `No. ${propertyAccess.text.en} If you're buying, the broker can help you as soon as a property is published.`,
    },
  } satisfies Record<string, FaqItem>;
}
