// Correos de Lixtara con dos vendedores (#220): la invitación y los recordatorios al segundo
// firmante, el aviso al vendedor cuando el segundo firmó y el de plazo vencido a los dos.
//
// Quién llama y por qué no se repiten:
//   - invitación: /api/agreement/create, al crear un sobre nuevo (clave cosigner-invite:<id>);
//   - recordatorios: el cron /api/agreement/deadlines, después de ganar la escritura de
//     agreements.reminders_sent (clave cosigner-reminder:<id>:<n>);
//   - reenvío: /api/agreement/resend, con su límite por listing;
//   - "firmó": agreement-refresh.ts, en la escritura que gana additional_signer_signed_at;
//   - "venció": agreement-refresh.ts, en la transición a "expired".
// Nunca lanzan, y nunca escriben nombres ni correos en los logs.

import { createService } from "@/lib/supabase/service";
import { SITE_URL } from "@/lib/config";
import { lookupRecipientLang } from "@/lib/email-recipient-lang";
import {
  sendCosignerExpired,
  sendCosignerInvitation,
  sendCosignerSigned,
  sendSigningExpired,
  type CosignerEmailKind,
  type CosignerRelationship,
} from "@/lib/email";

export interface Cosigner {
  name: string;
  email: string;
}

interface AgreementContext {
  id: string;
  propertyId: string;
  ownerId: string;
  sellerName: string;
  sellerEmail: string | null;
  deadlineIso: string | null;
  address: string;
  lang: "en" | "es";
  /** El segundo firmante guardado en el paso 3. */
  signer: (Cosigner & { relationship: CosignerRelationship }) | null;
}

async function loadContext(agreementId: string): Promise<AgreementContext | null> {
  const svc = createService();
  const { data: a } = await svc
    .from("agreements")
    .select("id,property_id,owner_id,signer_name,signer_email,signing_deadline_at")
    .eq("id", agreementId)
    .maybeSingle();
  if (!a) return null;
  const [{ data: prop }, { data: signer }, lang] = await Promise.all([
    svc.from("properties").select("address_street,address_city,address_state,address_zip").eq("id", a.property_id).maybeSingle(),
    svc.from("listing_additional_signers").select("full_name,email,relationship").eq("property_id", a.property_id).maybeSingle(),
    lookupRecipientLang(a.owner_id),
  ]);
  if (!prop) return null;
  return {
    id: a.id,
    propertyId: a.property_id,
    ownerId: a.owner_id,
    sellerName: a.signer_name ?? "",
    sellerEmail: a.signer_email ?? null,
    deadlineIso: a.signing_deadline_at ?? null,
    address: `${prop.address_street}, ${prop.address_city}, ${prop.address_state} ${prop.address_zip}`,
    lang: lang ?? "en",
    signer: signer
      ? {
          name: signer.full_name,
          email: signer.email,
          relationship: signer.relationship === "homestead_spouse" ? "homestead_spouse" : "title_holder",
        }
      : null,
  };
}

const stepUrl = (c: AgreementContext) => `${SITE_URL}/${c.lang}/listing/new?id=${c.propertyId}&step=7`;

function logFailure(event: string, agreementId: string, error: string | undefined) {
  console.error(JSON.stringify({ event, agreementId, error: error ?? "unknown" }));
}

/**
 * Invitación, recordatorio o reenvío al segundo firmante. `cosigner` es el destinatario tal como
 * está en el sobre (DocuSign); sin él, el guardado en el paso 3.
 */
export async function notifyCosignerInvitation(
  agreementId: string,
  kind: CosignerEmailKind,
  opts: { reminder?: 1 | 2; cosigner?: Cosigner | null; idempotencyKey?: string } = {},
): Promise<boolean> {
  try {
    const c = await loadContext(agreementId);
    const to = opts.cosigner ?? c?.signer;
    if (!c || !to?.email || !c.deadlineIso) return false;
    const key =
      opts.idempotencyKey ??
      (kind === "reminder" ? `cosigner-reminder:${agreementId}:${opts.reminder ?? 1}` : `cosigner-${kind}:${agreementId}`);
    const r = await sendCosignerInvitation({
      to: to.email,
      lang: c.lang,
      kind,
      sellerName: c.sellerName,
      signerName: to.name || c.signer?.name || "",
      relationship: c.signer?.relationship ?? "title_holder",
      propertyAddress: c.address,
      deadlineIso: c.deadlineIso,
      idempotencyKey: key,
    });
    if (!r.ok) logFailure("cosigner_email_failed", agreementId, r.error);
    return r.ok;
  } catch (e) {
    logFailure("cosigner_email_failed", agreementId, e instanceof Error ? e.message : undefined);
    return false;
  }
}

/** Al vendedor: el segundo firmante ya firmó y falta su firma. */
export async function notifyCosignerSigned(agreementId: string, cosigner: Cosigner | null): Promise<void> {
  try {
    const c = await loadContext(agreementId);
    if (!c?.sellerEmail) return;
    const r = await sendCosignerSigned({
      to: c.sellerEmail,
      lang: c.lang,
      signerName: cosigner?.name || c.signer?.name || "",
      propertyAddress: c.address,
      stepUrl: stepUrl(c),
    });
    if (!r.ok) logFailure("cosigner_signed_email_failed", agreementId, r.error);
  } catch (e) {
    logFailure("cosigner_signed_email_failed", agreementId, e instanceof Error ? e.message : undefined);
  }
}

/** A los dos: el plazo venció sin todas las firmas y el sobre se anuló. */
export async function notifySigningExpired(agreementId: string, cosigner: Cosigner | null): Promise<void> {
  try {
    const c = await loadContext(agreementId);
    if (!c) return;
    const to = cosigner ?? c.signer;
    const sends: Promise<{ ok: boolean; error?: string }>[] = [];
    if (c.sellerEmail) {
      sends.push(
        sendSigningExpired({
          to: c.sellerEmail,
          lang: c.lang,
          signerName: to?.name ?? "",
          propertyAddress: c.address,
          stepUrl: stepUrl(c),
          idempotencyKey: `signing-expired:${agreementId}:seller`,
        }),
      );
    }
    if (to?.email) {
      sends.push(
        sendCosignerExpired({
          to: to.email,
          lang: c.lang,
          sellerName: c.sellerName,
          propertyAddress: c.address,
          idempotencyKey: `signing-expired:${agreementId}:cosigner`,
        }),
      );
    }
    for (const r of await Promise.all(sends)) if (!r.ok) logFailure("signing_expired_email_failed", agreementId, r.error);
  } catch (e) {
    logFailure("signing_expired_email_failed", agreementId, e instanceof Error ? e.message : undefined);
  }
}
