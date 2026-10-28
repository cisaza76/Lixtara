// POST /api/agreement/resend — body: { property_id }
//
// Paso 7 con dos vendedores (#220): el vendedor vuelve a mandar la invitación al segundo
// firmante mientras el sobre lo espera y el plazo no venció. DocuSign reenvía su correo (con el
// enlace para firmar) y Lixtara el suyo. Con el plazo vencido no hay reenvío: el paso 7 crea un
// sobre nuevo, con otro plazo.
//
// Límite: RESEND_MAX por listing en 24 horas, contado después de comprobar que es del
// vendedor. Nunca escribe nombres ni correos en logs.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createService } from "@/lib/supabase/service";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";
import { refreshAgreement } from "@/lib/agreement-refresh";
import { getEnvelopeSigners, resendEnvelope, secondSellerOf } from "@/lib/docusign";
import { notifyCosignerInvitation } from "@/lib/cosigner-notify.server";
import { canResendInvitation, type DeadlineRow } from "@/lib/signing-deadline";

export const maxDuration = 30;

/** Reenvíos por listing en 24 horas. */
const RESEND_MAX = 3;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  let body: { property_id?: string };
  try {
    body = (await req.json()) as { property_id?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const propertyId = body.property_id;
  if (!propertyId || !/^[0-9a-f-]{36}$/i.test(propertyId)) {
    return NextResponse.json({ error: "property_id_required" }, { status: 400 });
  }

  // RLS own-select + filtro explícito: solo el dueño del listing.
  const { data: agreement } = await supabase
    .from("agreements")
    .select("id,envelope_id,property_id,status,sellers_required,additional_signer_signed_at,signing_deadline_at")
    .eq("property_id", propertyId)
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!agreement?.envelope_id) return NextResponse.json({ error: "no_agreement" }, { status: 404 });

  const limited = await enforceLimit(apiLimiter("agreement:resend", RESEND_MAX, "24 h"), `p:${propertyId}`, {
    label: "agreement:resend",
    message: "You already resent the invitation several times today. Try again tomorrow.",
  });
  if (limited) return limited;

  // El estado real primero: si el segundo ya firmó, o el plazo venció, no se reenvía.
  const status = await refreshAgreement(agreement);
  const { data: fresh } = await createService()
    .from("agreements")
    .select("sellers_required,additional_signer_signed_at,signing_deadline_at")
    .eq("id", agreement.id)
    .maybeSingle();
  const row = { ...agreement, ...((fresh ?? {}) as Partial<DeadlineRow>) };
  if (!canResendInvitation(status, row, new Date())) {
    return NextResponse.json({ error: "not_resendable", status }, { status: 409 });
  }

  try {
    await resendEnvelope(agreement.envelope_id);
  } catch (e) {
    console.error(
      JSON.stringify({ event: "agreement_resend_failed", agreementId: agreement.id, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }),
    );
    return NextResponse.json({ error: "docusign_unavailable" }, { status: 503 });
  }
  const cosigner = secondSellerOf(await getEnvelopeSigners(agreement.envelope_id).catch(() => []));
  await notifyCosignerInvitation(agreement.id, "resend", {
    cosigner: cosigner?.email ? { name: cosigner.name ?? "", email: cosigner.email } : null,
    // Cada reenvío es un correo nuevo (el límite de arriba evita la ráfaga).
    idempotencyKey: `cosigner-resend:${agreement.id}:${Date.now()}`,
  });
  return NextResponse.json({ ok: true });
}
