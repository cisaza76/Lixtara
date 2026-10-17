// Textos EXACTOS de las casillas de consentimiento, versionados. Lo que se guarda en
// terms_acceptances (versión + idioma + SHA-256 del texto) se reconstruye desde aquí: un texto
// publicado NUNCA se edita en el mismo lugar; se agrega una versión nueva y se conserva la
// anterior en HISTORY (el test falla si cambia el hash de una versión ya registrada).
//
// BORRADOR 2026-10 pendiente de revisión del abogado (docs/legal/memo-revision-*).
import { LEGAL_DOCS } from "./config";

export type ConsentDocument = "terms_refund" | "esign" | "calls_sms";
export type ConsentLang = "en" | "es";

/** Un texto con, opcionalmente, una parte enlazada (p. ej. "Términos" → /terms#refunds). */
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
}

export const CONSENTS: Record<ConsentDocument, ConsentDefinition> = {
  // Paso 8, antes de "Pagar con Stripe". La política vive en los Términos (#refunds), así que
  // la versión es la de los Términos.
  terms_refund: {
    version: LEGAL_DOCS.terms.version,
    checkbox: {
      en: {
        before:
          "I understand that the fee is non-refundable once my listing is published on the MLS, except as provided in the ",
        link: "Terms",
        after: ".",
      },
      es: {
        before:
          "Entiendo que la tarifa no es reembolsable una vez mi listing esté publicado en el MLS, salvo las excepciones de los ",
        link: "Términos",
        after: ".",
      },
    },
  },
  // Paso 7, antes de abrir DocuSign. [VERIFICAR con el abogado: contenido mínimo del aviso
  // del E-SIGN Act (15 U.S.C. §7001(c)) y de la UETA de Florida (§668.50 F.S.)].
  esign: {
    version: "2026-10-16-draft",
    notice: {
      en: [
        "You'll sign the listing agreement and related documents electronically through DocuSign. Before you continue:",
        "Your electronic signature has the same effect as a handwritten one. You can ask for a paper copy of any signed document at no cost by writing to {supportEmail}.",
        "You can withdraw this consent at any time before signing by writing to the same address; we'll then arrange paper signing, which may delay your listing. Withdrawing doesn't affect documents you already signed.",
        "You'll need a device with an up-to-date web browser, an internet connection, a valid email address and a way to view and save PDF files. Keep your email address up to date in your account.",
      ],
      es: [
        "Firmará el acuerdo de listado y los documentos relacionados de forma electrónica, a través de DocuSign. Antes de continuar:",
        "Su firma electrónica tiene el mismo efecto que una firma a mano. Puede pedir una copia en papel de cualquier documento firmado, sin costo, escribiendo a {supportEmail}.",
        "Puede retirar este consentimiento en cualquier momento antes de firmar escribiendo a la misma dirección; en ese caso coordinaremos la firma en papel, lo que puede retrasar su listado. Retirarlo no afecta los documentos que ya firmó.",
        "Necesita un dispositivo con un navegador web actualizado, conexión a internet, un correo electrónico válido y una forma de ver y guardar archivos PDF. Mantenga su correo actualizado en su cuenta.",
      ],
    },
    checkbox: {
      en: { before: "I agree to receive and sign these documents electronically." },
      es: { before: "Acepto recibir y firmar estos documentos de forma electrónica." },
    },
  },
  // Reservado: llamadas y SMS. Aún no se muestra en ningún formulario (ver memo).
  // [VERIFICAR con el abogado: TCPA (47 U.S.C. §227) y Florida Telephone Solicitation Act
  // (§501.059 F.S.): identificar al vendedor, sistemas automatizados, STOP/HELP, frecuencia,
  // tarifas del operador, y que no es condición de compra.]
  calls_sms: {
    version: "2026-10-16-draft",
    checkbox: {
      en: {
        before:
          "Optional: I agree that {legalName} may call or text me at the number I provided, including with automated technology, about my listing and its services. Message and data rates may apply. Reply STOP to opt out. Consent is not a condition of purchase.",
      },
      es: {
        before:
          "Opcional: acepto que {legalName} me llame o me envíe mensajes de texto al número que indiqué, incluso con tecnología automatizada, sobre mi listado y sus servicios. Pueden aplicar cargos por mensajes y datos. Responda STOP para cancelar. El consentimiento no es condición de compra.",
      },
    },
  },
};

/** El texto exacto que vio la persona (aviso + casilla), con los marcadores ya resueltos. */
export function consentFullText(
  doc: ConsentDocument,
  lang: ConsentLang,
  fill: (s: string) => string,
): string {
  const d = CONSENTS[doc];
  const notice = (d.notice?.[lang] ?? []).map(fill);
  const c = d.checkbox[lang];
  const box = fill(`${c.before}${c.link ?? ""}${c.after ?? ""}`);
  return [...notice, box].join("\n");
}

/**
 * SHA-256 de cada versión ya registrable de cada texto (aviso + casilla, con los marcadores
 * resueltos). Un texto con una versión de esta lista no se puede editar: el test
 * (site-coherence.test.ts) falla si su hash cambia. Para cambiarlo, versión nueva + hash nuevo
 * aquí, y se conservan los anteriores para reconstruir lo que vio cada persona.
 */
export const PUBLISHED_CONSENT_HASHES: Record<string, Record<ConsentLang, string>> = {
  "terms_refund@2026-10-16-draft": {
    en: "369b84c57dcc011d782f92d1ac8437a431bd730db43b7149901f2ac1d3da8e72",
    es: "8758326b19f6119b6ecbb9bfdd33cf8743087393b7d1a68b1d048b70449fb2ca",
  },
  "esign@2026-10-16-draft": {
    en: "68f24f6a77702fb6e0d7ddfc622d4bd99f446087a2c2433fef1214efa6628b9e",
    es: "380d34f4d33f003d7542981d68634ea5614e45642150c9c169d4a9d242355b83",
  },
  "calls_sms@2026-10-16-draft": {
    en: "c4196845f3adf44e56cab596a0b12623e83ecd9d968698ae127efbb69f0ab79c",
    es: "069a2ad2a1da4e3b127324d55ba61a48587e2cafb747eed0f88b6673349021a8",
  },
};
