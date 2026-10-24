// Textos EXACTOS de las casillas de consentimiento, versionados. Lo que se guarda en
// terms_acceptances (versión + idioma + SHA-256 del texto) se reconstruye desde aquí: un texto
// publicado NUNCA se edita en el mismo lugar. Para cambiarlo, la versión vigente pasa a
// `previous` tal como estaba y se escribe una versión nueva (consents.test.ts reconstruye cada
// versión registrada, vigente o anterior, y falla si su hash cambia).
//
// v2 (2026-10-18), publicada por decisión del owner sin revisión del abogado todavía:
// docs/legal/2026-10-18-textos-v2-memo.md. Las aceptaciones ya registradas conservan la v1.
// La casilla del paso 8 lleva el precio y la comisión del plan ({fee}, {pct}, desde
// pricing-tiers.ts): el hash es el del texto con esos valores, el que vio la persona.
import type { PricingTierId } from "@/lib/pricing-tiers";
import { LEGAL_DOCS, fillLegalCopy, planConsentVars } from "./config";

export type ConsentDocument = "terms" | "terms_refund" | "esign" | "calls_sms";
export type ConsentLang = "en" | "es";

/**
 * Un texto con, opcionalmente, partes enlazadas:
 * before + link + middle + link2 + middle2 + link3 + after. Los enlaces son textos; a dónde
 * apuntan lo dice `ConsentDefinition.links` (no entra en el hash).
 */
export interface ConsentParts {
  before: string;
  link?: string;
  middle?: string;
  link2?: string;
  middle2?: string;
  link3?: string;
  after?: string;
}

const PART_KEYS = ["link", "middle", "link2", "middle2", "link3", "after"] as const;

export interface ConsentVersion {
  version: string;
  /** Párrafos que se muestran ANTES de la casilla (aviso E-SIGN); entran en el hash. */
  notice?: Record<ConsentLang, string[]>;
  checkbox: Record<ConsentLang, ConsentParts>;
}

export interface ConsentDefinition extends ConsentVersion {
  /** El texto lleva {fee} y {pct}: hace falta el plan para mostrarlo y para el hash. */
  perPlan?: boolean;
  /** Rutas sin idioma de link, link2 y link3, en ese orden. */
  links?: string[];
  /** Versiones anteriores, tal como se mostraron. Nunca se editan. */
  previous?: ConsentVersion[];
}

// Textos v1 (2026-10-18), conservados para reconstruir las aceptaciones registradas con ellos.
const TERMS_V1: ConsentVersion = {
  version: "terms-2026-10-18-v1+privacy-2026-10-18-v1",
  checkbox: {
    en: { before: "I agree to the ", link: "Terms of Service", middle: " and ", link2: "Privacy Policy", after: "." },
    es: { before: "Acepto los ", link: "Términos de servicio", middle: " y la ", link2: "Política de privacidad", after: "." },
  },
};

// Casilla de los Términos desde la v2 (con el arbitraje de la §17). Sin cambios en la v3.
const TERMS_CHECKBOX: Record<ConsentLang, ConsentParts> = {
  en: {
    before: "I agree to the ",
    link: "Terms of Service",
    middle: ", including the ",
    link2: "arbitration agreement in Section 17",
    middle2: ", and the ",
    link3: "Privacy Policy",
    after: ".",
  },
  es: {
    before: "Acepto los ",
    link: "Términos de servicio",
    middle: ", incluido el ",
    link2: "acuerdo de arbitraje de la Sección 17",
    middle2: ", y la ",
    link3: "Política de privacidad",
    after: ".",
  },
};

// v2 (2026-10-18): misma casilla, aceptada con los Términos v2.
const TERMS_V2: ConsentVersion = { version: "terms-2026-10-18-v2+privacy-2026-10-18-v2", checkbox: TERMS_CHECKBOX };

// v3 de los Términos con la Privacidad v2 (2026-10-21 → 2026-10-24): misma casilla.
const TERMS_V3: ConsentVersion = { version: "terms-2026-10-21-v3+privacy-2026-10-18-v2", checkbox: TERMS_CHECKBOX };

// Casilla del paso 8 v1/v2 (2026-10-18): conservada para reconstruir las aceptaciones registradas.
const TERMS_REFUND_CHECKBOX_V1: Record<ConsentLang, ConsentParts> = {
  en: {
    before:
      "I understand that the {fee} flat fee is charged whether or not my home sells and is non-refundable once my home is published on the MLS. If my listing ends before publication, I receive a full refund. The {pct} commission is due only if a sale closes.",
  },
  es: {
    before:
      "Entiendo que la tarifa fija de {fee} se cobra se venda o no mi propiedad y que no es reembolsable una vez publicada en el MLS. Si mi listado termina antes de la publicación, recibo el reembolso total. La comisión del {pct} solo se paga si la venta se cierra.",
  },
};

// v3 (2026-10-21, modelo final del owner; párrafo 15 del ERS-21tn): el vendedor puede terminar
// el acuerdo en cualquier momento, sin costo; la comisión solo si la venta se cierra, al cierre.
// Pendiente de revisión del abogado.
const TERMS_REFUND_CHECKBOX: Record<ConsentLang, ConsentParts> = {
  en: {
    before:
      "I understand that the {fee} flat fee is charged whether or not my home sells and is non-refundable once my home is published on the MLS. If my listing ends before publication, I receive a full refund. I can end my listing agreement at any time, at no charge. The {pct} commission is due only if a sale closes, and it's paid at closing.",
  },
  es: {
    before:
      "Entiendo que la tarifa fija de {fee} se cobra se venda o no mi propiedad y que no es reembolsable una vez publicada en el MLS. Si mi listado termina antes de la publicación, recibo el reembolso total. Puedo terminar mi acuerdo de listado en cualquier momento, sin costo. La comisión del {pct} solo se paga si la venta se cierra, al momento del cierre.",
  },
};

const ESIGN_CHECKBOX: Record<ConsentLang, ConsentParts> = {
  en: { before: "I agree to receive and sign these documents electronically." },
  es: { before: "Acepto recibir y firmar estos documentos de forma electrónica." },
};

const ESIGN_V1: ConsentVersion = {
  version: "2026-10-18-v1",
  notice: {
    en: [
      "You'll sign the listing agreement and related documents electronically through DocuSign. Before you continue:",
      "Your electronic signature has the same effect as a handwritten one. You can ask for a paper copy of any signed document at no cost by writing to {supportEmail}.",
      "You can withdraw this consent at any time before signing by writing to the same address; we'll then arrange paper signing, which may delay your listing. Withdrawing doesn't affect documents you already signed.",
      "You'll need a device with an up-to-date web browser, an internet connection, a valid email address and a way to view and save PDF files. Keep your email address up to date in your account.",
    ],
    es: [
      "Firmarás el acuerdo de listado y los documentos relacionados de forma electrónica, a través de DocuSign. Antes de continuar:",
      "Tu firma electrónica tiene el mismo efecto que una firma a mano. Puedes pedir una copia en papel de cualquier documento firmado, sin costo, escribiendo a {supportEmail}.",
      "Puedes retirar este consentimiento en cualquier momento antes de firmar escribiendo a la misma dirección; en ese caso coordinaremos la firma en papel, lo que puede retrasar tu listado. Retirarlo no afecta los documentos que ya firmaste.",
      "Necesitas un dispositivo con un navegador web actualizado, conexión a internet, un correo electrónico válido y una forma de ver y guardar archivos PDF. Mantén tu correo actualizado en tu cuenta.",
    ],
  },
  checkbox: ESIGN_CHECKBOX,
};

export const CONSENTS: Record<ConsentDocument, ConsentDefinition> = {
  // Aceptación expresa de los Términos (con su arbitraje, §17) y la Privacidad al crear la
  // cuenta: /sign-up y el registro del paso 7. Sin la casilla no se crea la cuenta. La versión
  // nombra los dos documentos.
  terms: {
    version: `terms-${LEGAL_DOCS.terms.version}+privacy-${LEGAL_DOCS.privacy.version}`,
    checkbox: TERMS_CHECKBOX,
    links: [LEGAL_DOCS.terms.path, `${LEGAL_DOCS.terms.path}#section-17`, LEGAL_DOCS.privacy.path],
    // Privacidad v4 (2026-10-24): misma casilla, versión nueva; las anteriores se conservan.
    previous: [TERMS_V1, TERMS_V2, TERMS_V3],
  },
  // Paso 8, antes de "Pagar con Stripe". Dice lo mismo que legal-terms.ts#refundPolicy, los
  // Términos §6 y la FAQ (site-claims.test.ts lo comprueba). La versión es la de los Términos:
  // el texto no cambió en la v2, pero se acepta junto con los Términos vigentes; en la v3
  // agrega la terminación sin costo y la comisión al cierre.
  terms_refund: {
    version: LEGAL_DOCS.terms.version,
    perPlan: true,
    checkbox: TERMS_REFUND_CHECKBOX,
    previous: [
      { version: "2026-10-18-v1", checkbox: TERMS_REFUND_CHECKBOX_V1 },
      { version: "2026-10-18-v2", checkbox: TERMS_REFUND_CHECKBOX_V1 },
    ],
  },
  // Paso 7, antes de abrir DocuSign. v2: el consentimiento se puede retirar "en cualquier
  // momento" (antes: "antes de firmar"). En español con tú, como el resto del flujo.
  esign: {
    version: "2026-10-18-v2",
    notice: {
      en: [
        ESIGN_V1.notice!.en[0],
        ESIGN_V1.notice!.en[1],
        "You can withdraw this consent at any time by writing to the same address; we'll then arrange paper signing, which may delay your listing. Withdrawing doesn't affect documents you already signed.",
        ESIGN_V1.notice!.en[3],
      ],
      es: [
        ESIGN_V1.notice!.es[0],
        ESIGN_V1.notice!.es[1],
        "Puedes retirar este consentimiento en cualquier momento escribiendo a la misma dirección; en ese caso coordinaremos la firma en papel, lo que puede retrasar tu listado. Retirarlo no afecta los documentos que ya firmaste.",
        ESIGN_V1.notice!.es[3],
      ],
    },
    checkbox: ESIGN_CHECKBOX,
    previous: [ESIGN_V1],
  },
  // Reservado: llamadas y SMS. Aún no se muestra en ningún formulario.
  calls_sms: {
    version: "2026-10-18-v1",
    checkbox: {
      en: {
        before:
          "Optional: I agree that {legalName} may call or text me at the number I provided, including with automated technology, about my listing and its services. Message and data rates may apply. Reply STOP to opt out. Consent is not a condition of purchase.",
      },
      es: {
        before:
          "Opcional: acepto que {legalName} me llame o me envíe mensajes de texto al número que indiqué, incluso con tecnología automatizada, sobre mi listado y sus servicios. Pueden aplicar cargos por mensajes y datos. Responde STOP para cancelar. El consentimiento no es condición de compra.",
      },
    },
  },
};

/** La versión pedida (vigente si se omite), o error si no existe. */
function consentVersion(doc: ConsentDocument, version?: string): ConsentVersion {
  const d = CONSENTS[doc];
  if (!version || version === d.version) return d;
  const prev = d.previous?.find((p) => p.version === version);
  if (!prev) throw new Error(`${doc}: no existe la versión ${version}`);
  return prev;
}

/** El aviso, con los marcadores ya resueltos (versión vigente si se omite). */
export function consentNotice(doc: ConsentDocument, lang: ConsentLang, version?: string): string[] {
  return (consentVersion(doc, version).notice?.[lang] ?? []).map((p) => fillLegalCopy(p));
}

/** La casilla, con los marcadores resueltos (y el plan, si el texto lo lleva). */
export function consentCheckbox(
  doc: ConsentDocument,
  lang: ConsentLang,
  tier?: PricingTierId | null,
  version?: string,
): ConsentParts {
  const d = CONSENTS[doc];
  if (d.perPlan && !tier) throw new Error(`${doc}: el texto lleva {fee}/{pct} y falta el plan`);
  const vars = d.perPlan && tier ? planConsentVars(tier) : undefined;
  const c = consentVersion(doc, version).checkbox[lang];
  const out: ConsentParts = { before: fillLegalCopy(c.before, vars) };
  for (const k of PART_KEYS) {
    const v = c[k];
    if (v) out[k] = fillLegalCopy(v, vars);
  }
  return out;
}

/** La casilla como texto plano (lo que entra en el hash). */
export function consentCheckboxText(parts: ConsentParts): string {
  return parts.before + PART_KEYS.map((k) => parts[k] ?? "").join("");
}

/** El texto exacto que vio la persona (aviso + casilla), con los marcadores ya resueltos. */
export function consentFullText(
  doc: ConsentDocument,
  lang: ConsentLang,
  tier?: PricingTierId | null,
  version?: string,
): string {
  return [...consentNotice(doc, lang, version), consentCheckboxText(consentCheckbox(doc, lang, tier, version))].join("\n");
}

/**
 * SHA-256 de cada versión registrable de cada texto (aviso + casilla, resueltos). La clave es
 * "documento@versión", más ":plan" si el texto depende del plan. Un texto con una versión de
 * esta lista no se puede editar: consents.test.ts falla si su hash cambia. Para cambiarlo,
 * versión nueva + hashes nuevos aquí, conservando los anteriores. La v2 de terms_refund tiene
 * el mismo texto (y hash) que la v1: cambió la versión de los Términos que acepta.
 */
export const PUBLISHED_CONSENT_HASHES: Record<string, Record<ConsentLang, string>> = {
  "terms@terms-2026-10-18-v1+privacy-2026-10-18-v1": {
    en: "d0c085087b7137968c04cb04f13ab9810c9ffbd0a994aec419929fb3db30c2c6",
    es: "1106e53c0a0dbf07dffb20ba7027179aad4af28846013a29a36badbdf557ac11",
  },
  "terms_refund@2026-10-18-v1:essentials": {
    en: "3a268aefac927d5b378919744059f26ef86605ee7d692af5ccdc206efcead1c2",
    es: "75fbb5c8e1b0648a8701864e3c00d81266039d72a3e1be13bfe01a6c13d0de96",
  },
  "terms_refund@2026-10-18-v1:pro": {
    en: "2b432e0361fdfd03beb6dab7ab94de265f129bd751b8970a76f96bf8bfe74ea7",
    es: "287cbdee2c5b882b4cf9f3681ef751739f414aba28096706424de008e35c5fcc",
  },
  "terms_refund@2026-10-18-v1:concierge": {
    en: "bcc38ee48bcf1c6f5d97953493e5e8ca8c2b7491c7d7ea9c4004055937da1066",
    es: "48baa37e3b29c0f7d06e0402656d08aab641e5f1d2273bd7bfd2b03d45bd7348",
  },
  "esign@2026-10-18-v1": {
    en: "68f24f6a77702fb6e0d7ddfc622d4bd99f446087a2c2433fef1214efa6628b9e",
    es: "baee83647fc8603cf82214913a8ed25cfbec1f120b20a99dccb01b97bfe199be",
  },
  "calls_sms@2026-10-18-v1": {
    en: "c4196845f3adf44e56cab596a0b12623e83ecd9d968698ae127efbb69f0ab79c",
    es: "2f18e97d01a26e30757601c45fb4fb60a5c2df0807c12ff5c96994d518523bf6",
  },
  "terms@terms-2026-10-18-v2+privacy-2026-10-18-v2": {
    en: "4c3ae511d2e3245df3fbf105c4c1c587c2e6dcb701747fea13cde78c2addecb6",
    es: "971219881754a9fde2d0243a491213ae7bdcadf90005650b52d8b1afe07c90c1",
  },
  "terms_refund@2026-10-18-v2:essentials": {
    en: "3a268aefac927d5b378919744059f26ef86605ee7d692af5ccdc206efcead1c2",
    es: "75fbb5c8e1b0648a8701864e3c00d81266039d72a3e1be13bfe01a6c13d0de96",
  },
  "terms_refund@2026-10-18-v2:pro": {
    en: "2b432e0361fdfd03beb6dab7ab94de265f129bd751b8970a76f96bf8bfe74ea7",
    es: "287cbdee2c5b882b4cf9f3681ef751739f414aba28096706424de008e35c5fcc",
  },
  "terms_refund@2026-10-18-v2:concierge": {
    en: "bcc38ee48bcf1c6f5d97953493e5e8ca8c2b7491c7d7ea9c4004055937da1066",
    es: "48baa37e3b29c0f7d06e0402656d08aab641e5f1d2273bd7bfd2b03d45bd7348",
  },
  "esign@2026-10-18-v2": {
    en: "4f9fbdf243093dc6946a823fbe5e146cade52ce8b6a7afee0cb71b93996c1df1",
    es: "e94a13b74ea25e0be1c5f12cc80342e99487ec6d0e9fbd9d98132a7437dc13f8",
  },
  // v3 (2026-10-21): la casilla de los Términos no cambia (mismo hash que la v2); la del paso 8
  // agrega la terminación sin costo y la comisión al cierre.
  "terms@terms-2026-10-21-v3+privacy-2026-10-18-v2": {
    en: "4c3ae511d2e3245df3fbf105c4c1c587c2e6dcb701747fea13cde78c2addecb6",
    es: "971219881754a9fde2d0243a491213ae7bdcadf90005650b52d8b1afe07c90c1",
  },
  // Misma casilla que la v2/v3 (mismo hash): cambió la versión de la Privacidad que se acepta.
  "terms@terms-2026-10-21-v3+privacy-2026-10-24-v4": {
    en: "4c3ae511d2e3245df3fbf105c4c1c587c2e6dcb701747fea13cde78c2addecb6",
    es: "971219881754a9fde2d0243a491213ae7bdcadf90005650b52d8b1afe07c90c1",
  },
  "terms_refund@2026-10-21-v3:essentials": {
    en: "d6f8d1cf5e138ae96a0c3dee5b1fdaf209e898dc4d714066e0b436b9b9ea60fb",
    es: "6594e297e24b9458f39b5d9db56699a959af7d604f3ef68e7e92f1ab2bb436bb",
  },
  "terms_refund@2026-10-21-v3:pro": {
    en: "a67a6704999dc8128d402bdbf68aca728103c99e3a5b516609a34921aa270c0c",
    es: "41693d3e168e38bf478319ff487a44958924a4f6db6badad5ae9814aa22208da",
  },
  "terms_refund@2026-10-21-v3:concierge": {
    en: "a5d42f6868b52514b56a8dfa90847a680f21d6d435fdfec266525c40a7f9341d",
    es: "13305510529284ef8a6146fc61388a2e7d26c4fd563d5cc739e526b0f9bec269",
  },
};
