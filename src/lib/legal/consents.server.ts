import { createHash } from "node:crypto";
import { createService } from "@/lib/supabase/service";
import { fillLegalCopy } from "./config";
import { CONSENTS, consentFullText, type ConsentDocument, type ConsentLang } from "./consents";

/** SHA-256 (hex) del texto exacto que se mostró. */
export function consentTextHash(doc: ConsentDocument, lang: ConsentLang): string {
  return createHash("sha256").update(consentFullText(doc, lang, fillLegalCopy), "utf8").digest("hex");
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]{2,39}$/i;

/** IP del cliente (Vercel: primer valor de x-forwarded-for) y user agent, para la prueba. */
export function requestEvidence(headers: Headers): { ip_address: string | null; user_agent: string | null } {
  const raw = (headers.get("x-forwarded-for") ?? headers.get("x-real-ip") ?? "").split(",")[0]!.trim();
  const ip = IPV4.test(raw) || IPV6.test(raw) ? raw : null;
  const ua = headers.get("user-agent");
  return { ip_address: ip, user_agent: ua ? ua.slice(0, 512) : null };
}

export interface AcceptanceInput {
  document: ConsentDocument;
  lang: ConsentLang;
  context: string;
  userId: string;
  propertyId?: string | null;
  stripeCheckoutSessionId?: string | null;
  headers: Headers;
}

/** Registra la aceptación (solo inserción, con la secret key). false = no quedó registrada. */
export async function recordAcceptance(input: AcceptanceInput): Promise<boolean> {
  const { error } = await createService()
    .from("terms_acceptances")
    .insert({
      user_id: input.userId,
      property_id: input.propertyId ?? null,
      document: input.document,
      version: CONSENTS[input.document].version,
      lang: input.lang,
      consent_text_hash: consentTextHash(input.document, input.lang),
      context: input.context,
      stripe_checkout_session_id: input.stripeCheckoutSessionId ?? null,
      ...requestEvidence(input.headers),
    });
  if (error) {
    console.error(JSON.stringify({ event: "terms_acceptance_insert_failed", document: input.document, message: error.message }));
    return false;
  }
  return true;
}
