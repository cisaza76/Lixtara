// Plazo de firma con dos vendedores (#220): lo que corre el cron /api/agreement/deadlines.
// Reglas: src/lib/signing-deadline.ts.
//
// Idempotente: cada recordatorio sale solo si esta corrida gana la escritura de
// agreements.reminders_sent (y Resend recibe una clave por acuerdo y número); el aviso de plazo
// vencido sale una vez, en la transición a "expired" (agreement-refresh.ts). Nunca escribe
// nombres ni correos en logs.

import { createService } from "@/lib/supabase/service";
import { isLatestAgreement, refreshAgreementResult } from "@/lib/agreement-refresh";
import { getEnvelopeSigners, getEnvelopeStatus, mapEnvelopeStatus, secondSellerOf, voidEnvelope } from "@/lib/docusign";
import { notifyCosignerInvitation } from "@/lib/cosigner-notify.server";
import { SIGNING_DEADLINE_DAYS } from "@/lib/listing-ownership";
import { AWAITING_SELLERS, deadlineAction, isAwaitingSellers, type DeadlineRow } from "@/lib/signing-deadline";

const BATCH = 50;
export const VOID_REASON = `The ${SIGNING_DEADLINE_DAYS}-day signing deadline passed without every seller's signature.`;

interface Row extends DeadlineRow {
  id: string;
  envelope_id: string | null;
  property_id: string;
  status: string;
}

export interface DeadlineRunResult {
  checked: number;
  reminded: number;
  expired: number;
  failed: number;
}

export async function runSigningDeadlines(now = new Date()): Promise<DeadlineRunResult> {
  const svc = createService();
  const { data, error } = await svc
    .from("agreements")
    .select("id,envelope_id,property_id,status,sellers_required,additional_signer_signed_at,signing_deadline_at,reminders_sent")
    .eq("sellers_required", 2)
    .is("additional_signer_signed_at", null)
    .not("signing_deadline_at", "is", null)
    .in("status", [...AWAITING_SELLERS])
    .order("signing_deadline_at", { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(`agreements query failed: ${error.code}`);

  const result: DeadlineRunResult = { checked: 0, reminded: 0, expired: 0, failed: 0 };
  for (const row of (data ?? []) as Row[]) {
    result.checked++;
    try {
      const outcome = await processAgreement(row, now);
      if (outcome === "reminded") result.reminded++;
      if (outcome === "expired") result.expired++;
    } catch (e) {
      result.failed++;
      console.error(
        JSON.stringify({ event: "signing_deadline_failed", agreementId: row.id, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }),
      );
    }
  }
  return result;
}

async function processAgreement(row: Row, now: Date): Promise<"reminded" | "expired" | "none"> {
  if (!row.envelope_id) return "none";
  // Un acuerdo reemplazado por un sobre nuevo (el paso 3 cambió) no recibe recordatorios ni vence.
  if (!(await isLatestAgreement(row))) return "none";
  // Primero, el estado real: una firma que el webhook no trajo, o un sobre que DocuSign ya venció.
  const refreshed = await refreshAgreementResult(row);
  if (!refreshed.fetched) throw new Error("docusign_unavailable");
  if (!isAwaitingSellers(refreshed.status)) return refreshed.status === "expired" ? "expired" : "none";
  const { data: fresh } = await createService()
    .from("agreements")
    .select("sellers_required,additional_signer_signed_at,signing_deadline_at,reminders_sent")
    .eq("id", row.id)
    .maybeSingle();
  const current = { ...row, ...((fresh ?? {}) as Partial<DeadlineRow>) };
  const action = deadlineAction(current, now);

  if (action.kind === "expire") {
    const env = await getEnvelopeStatus(row.envelope_id);
    const mapped = mapEnvelopeStatus(env.status);
    if (mapped === "pending" || mapped === "sent" || mapped === "delivered") {
      await voidEnvelope(row.envelope_id, VOID_REASON);
    }
    // La transición a "expired" (y el aviso a los dos) la hace la actualización del acuerdo.
    const after = await refreshAgreementResult({ ...row, status: refreshed.status });
    if (!after.fetched) throw new Error("docusign_unavailable");
    return after.status === "expired" ? "expired" : "none";
  }

  if (action.kind === "remind") {
    const prev = current.reminders_sent ?? 0;
    const { data: claimed } = await createService()
      .from("agreements")
      .update({ reminders_sent: action.reminder, updated_at: now.toISOString() })
      .eq("id", row.id)
      .eq("reminders_sent", prev)
      .select("id");
    if (!claimed?.length) return "none";
    const cosigner = secondSellerOf(await getEnvelopeSigners(row.envelope_id));
    await notifyCosignerInvitation(row.id, "reminder", {
      reminder: action.reminder,
      cosigner: cosigner?.email ? { name: cosigner.name ?? "", email: cosigner.email } : null,
    });
    return "reminded";
  }
  return "none";
}

