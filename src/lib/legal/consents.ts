// Textos EXACTOS de las casillas de consentimiento, versionados. Lo que se guarda en
// terms_acceptances (versión + idioma + SHA-256 del texto) se reconstruye desde aquí: un texto
// publicado NUNCA se edita en el mismo lugar; se agrega una versión nueva y se conserva la
// anterior (src/lib/legal/consents.test.ts falla si cambia el hash de una versión registrada).
//
// Textos v1 (2026-10-18) PENDIENTES DE APROBACIÓN LEGAL: docs/legal/2026-10-18-textos-v1-memo.md.
// La casilla del paso 8 lleva el precio y la comisión del plan ({fee}, {pct}, desde
// pricing-tiers.ts): el hash es el del texto con esos valores, el que vio la persona.
import type { PricingTierId } from "@/lib/pricing-tiers";
import { LEGAL_DOCS, fillLegalCopy, planConsentVars } from "./config";

export type ConsentDocument = "terms_refund" | "esign" | "calls_sms";
export type ConsentLang = "en" | "es";

/** Un texto con, opcionalmente, una parte enlazada. */
export interface ConsentParts {
  before: string;
  link?: string;
  after?: string;
}

export interface ConsentDefinition {
  version: string;
  /** Párrafos que se muestran ANTES de la casilla (aviso E-SIGN); entran en el hash. */
  notice?: Record<ConsentLang, string[]>;
  checkbox: Record<ConsentLang, ConsentParts>;
  /** El texto lleva {fee} y {pct}: hace falta el plan para mostrarlo y para el hash. */
  perPlan?: boolean;
}

export const CONSENTS: Record<ConsentDocument, ConsentDefinition> = {
  // Paso 8, antes de "Pagar con Stripe". Dice lo mismo que legal-terms.ts#refundPolicy, los
  // Términos §6 y la FAQ (site-claims.test.ts lo comprueba). La versión es la de los Términos.
  terms_refund: {
    version: LEGAL_DOCS.terms.version,
    perPlan: true,
    checkbox: {
      en: {
        before:
          "I understand that the {fee} flat fee is charged whether or not my home sells and is non-refundable once my home is published on the MLS. If my listing ends before publication, I receive a full refund. The {pct} commission is due only if a sale closes.",
      },
      es: {
        before:
          "Entiendo que la tarifa fija de {fee} se cobra se venda o no mi propiedad y que no es reembolsable una vez publicada en el MLS. Si mi listado termina antes de la publicación, recibo el reembolso total. La comisión del {pct} solo se paga si la venta se cierra.",
      },
    },
  },
  // Paso 7, antes de abrir DocuSign (texto del #203). [VERIFICAR con el abogado: contenido
  // mínimo del aviso del E-SIGN Act (15 U.S.C. §7001(c)) y de la UETA de Florida (§668.50 F.S.)].
  esign: {
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
    checkbox: {
      en: { before: "I agree to receive and sign these documents electronically." },
      es: { before: "Acepto recibir y firmar estos documentos de forma electrónica." },
    },
  },
  // Reservado: llamadas y SMS. Aún no se muestra en ningún formulario (queda en el #203).
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

/** El aviso, con los marcadores ya resueltos. */
export function consentNotice(doc: ConsentDocument, lang: ConsentLang): string[] {
  return (CONSENTS[doc].notice?.[lang] ?? []).map((p) => fillLegalCopy(p));
}

/** La casilla, con los marcadores resueltos (y el plan, si el texto lo lleva). */
export function consentCheckbox(doc: ConsentDocument, lang: ConsentLang, tier?: PricingTierId | null): ConsentParts {
  const d = CONSENTS[doc];
  if (d.perPlan && !tier) throw new Error(`${doc}: el texto lleva {fee}/{pct} y falta el plan`);
  const vars = d.perPlan && tier ? planConsentVars(tier) : undefined;
  const c = d.checkbox[lang];
  return {
    before: fillLegalCopy(c.before, vars),
    ...(c.link ? { link: fillLegalCopy(c.link, vars) } : {}),
    ...(c.after ? { after: fillLegalCopy(c.after, vars) } : {}),
  };
}

/** El texto exacto que vio la persona (aviso + casilla), con los marcadores ya resueltos. */
export function consentFullText(doc: ConsentDocument, lang: ConsentLang, tier?: PricingTierId | null): string {
  const c = consentCheckbox(doc, lang, tier);
  return [...consentNotice(doc, lang), `${c.before}${c.link ?? ""}${c.after ?? ""}`].join("\n");
}

/**
 * SHA-256 de cada versión registrable de cada texto (aviso + casilla, resueltos). La clave es
 * "documento@versión", más ":plan" si el texto depende del plan. Un texto con una versión de
 * esta lista no se puede editar: consents.test.ts falla si su hash cambia. Para cambiarlo,
 * versión nueva + hashes nuevos aquí, conservando los anteriores.
 */
export const PUBLISHED_CONSENT_HASHES: Record<string, Record<ConsentLang, string>> = {
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
};
