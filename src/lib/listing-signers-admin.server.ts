// Lecturas y marcas del staff sobre el titular y los firmantes (#220). Las marcas van con la
// sesión del staff: RLS "listing_ownership staff update" + trigger guard_listing_signers, que
// solo le dejan cambiar las columnas de staff. Cada marca queda en activity_log.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createService } from "@/lib/supabase/service";
import {
  agreementSignerLines,
  canClearManualReview,
  ownershipApprovalGate,
  type OwnershipGate,
  type StaffOwnership,
} from "@/lib/listing-signers-admin";

const OWNERSHIP_COLS =
  "owner_kind,other_title_holders,married_homestead,entity_name,entity_signer_title,entity_authority_confirmed_at,manual_review_reason,sunbiz_status,sunbiz_checked_at,authority_document_received_at,manual_review_cleared_at";

export interface StaffSigner {
  full_name: string;
  email: string;
  relationship: string;
}

/** Titular y segundo firmante (clave de servicio: el llamador ya comprobó que es staff). */
export async function loadOwnershipForStaff(
  propertyId: string,
): Promise<{ ownership: StaffOwnership | null; signer: StaffSigner | null }> {
  const svc = createService();
  const [{ data: o }, { data: s }] = await Promise.all([
    svc.from("listing_ownership").select(OWNERSHIP_COLS).eq("property_id", propertyId).maybeSingle(),
    svc.from("listing_additional_signers").select("full_name,email,relationship").eq("property_id", propertyId).maybeSingle(),
  ]);
  return { ownership: (o ?? null) as StaffOwnership | null, signer: (s ?? null) as StaffSigner | null };
}

/** ¿El titular deja aprobar el listing? Si no se puede leer, no (falla cerrado). */
export async function ownershipGateFor(propertyId: string): Promise<OwnershipGate> {
  const { data, error } = await createService()
    .from("listing_ownership")
    .select(OWNERSHIP_COLS)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (error) return { ok: false, reason: "sunbiz_unchecked" };
  return ownershipApprovalGate((data ?? null) as StaffOwnership | null);
}

/** Titulares en revisión manual sin destrabar (la cola del admin). */
export async function manualReviewQueue(): Promise<Array<{ property_id: string; manual_review_reason: string | null }>> {
  const { data } = await createService()
    .from("listing_ownership")
    .select("property_id,manual_review_reason")
    .eq("owner_kind", "manual_review")
    .is("manual_review_cleared_at", null)
    .order("updated_at", { ascending: false })
    .limit(50);
  return (data ?? []) as Array<{ property_id: string; manual_review_reason: string | null }>;
}

export type StaffMark =
  | { kind: "sunbiz"; status: "listed" | "not_listed" }
  | { kind: "authority_document" }
  | { kind: "clear_manual_review" };

export type StaffMarkResult = { ok: true } | { ok: false; error: "not_applicable" | "save_failed" };

export async function applyStaffMark(
  sb: SupabaseClient,
  userId: string,
  propertyId: string,
  mark: StaffMark,
): Promise<StaffMarkResult> {
  const { data: current } = await sb
    .from("listing_ownership")
    .select("owner_kind,manual_review_reason,sunbiz_status")
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!current) return { ok: false, error: "not_applicable" };
  const now = new Date().toISOString();
  let update: Record<string, unknown>;
  let description: string;
  if (mark.kind === "sunbiz") {
    if (current.owner_kind !== "fl_entity") return { ok: false, error: "not_applicable" };
    update = { sunbiz_status: mark.status, sunbiz_checked_by: userId, sunbiz_checked_at: now };
    description = `Sunbiz: signer ${mark.status === "listed" ? "listed" : "not listed"}`;
  } else if (mark.kind === "authority_document") {
    if (current.owner_kind !== "fl_entity" || current.sunbiz_status !== "not_listed") return { ok: false, error: "not_applicable" };
    update = { authority_document_received_at: now, authority_document_received_by: userId };
    description = "Entity authority document received";
  } else {
    if (current.owner_kind !== "manual_review" || !canClearManualReview(current.manual_review_reason)) {
      return { ok: false, error: "not_applicable" };
    }
    update = { manual_review_cleared_at: now, manual_review_cleared_by: userId };
    description = "Owner manual review unlocked";
  }
  const { data: saved, error } = await sb
    .from("listing_ownership")
    .update({ ...update, updated_at: now })
    .eq("property_id", propertyId)
    .select("property_id");
  if (error || !saved?.length) {
    console.error(JSON.stringify({ event: "staff_mark_failed", propertyId, kind: mark.kind, code: error?.code ?? "no_row" }));
    return { ok: false, error: "save_failed" };
  }
  await sb.from("activity_log").insert({
    user_id: userId,
    property_id: propertyId,
    action_type: `ownership_${mark.kind}`,
    description,
  });
  return { ok: true };
}

export interface QueueSigning {
  lines: ReturnType<typeof agreementSignerLines>;
  gate: OwnershipGate;
  /** Estado guardado del acuerdo más reciente (null = sin acuerdo). */
  agreementStatus: string | null;
}

/**
 * Para la cola de aprobación: firmantes (estado guardado, sin llamar a DocuSign por fila) y el
 * bloqueo por titular de cada listing.
 */
export async function queueSignersByProperty(
  propertyIds: string[],
): Promise<Map<string, QueueSigning>> {
  const out = new Map<string, QueueSigning>();
  if (propertyIds.length === 0) return out;
  const svc = createService();
  const [{ data: owners }, { data: signers }, { data: agreements }] = await Promise.all([
    svc.from("listing_ownership").select(`property_id,${OWNERSHIP_COLS}`).in("property_id", propertyIds),
    svc.from("listing_additional_signers").select("property_id,full_name,relationship").in("property_id", propertyIds),
    svc
      .from("agreements")
      .select("property_id,status,signer_name,sellers_required,additional_signer_signed_at,created_at")
      .in("property_id", propertyIds)
      .order("created_at", { ascending: false }),
  ]);
  type OwnerRow = StaffOwnership & { property_id: string };
  type SignerRow = { property_id: string; full_name: string; relationship: string };
  type AgreementRow = {
    property_id: string;
    status: string;
    signer_name: string | null;
    sellers_required: number | null;
    additional_signer_signed_at: string | null;
  };
  const ownerBy = new Map(((owners ?? []) as unknown as OwnerRow[]).map((o) => [o.property_id, o]));
  const signerBy = new Map(((signers ?? []) as SignerRow[]).map((s) => [s.property_id, s]));
  const agreementBy = new Map<string, AgreementRow>();
  for (const a of (agreements ?? []) as AgreementRow[]) if (!agreementBy.has(a.property_id)) agreementBy.set(a.property_id, a);
  for (const id of propertyIds) {
    const ownership = ownerBy.get(id) ?? null;
    const agreement = agreementBy.get(id) ?? null;
    out.set(id, {
      lines: agreementSignerLines({
        ownership,
        sellerName: agreement?.signer_name ?? null,
        cosigner: signerBy.get(id) ?? null,
        agreement,
        live: null,
        propertyId: id,
      }),
      gate: ownershipApprovalGate(ownership),
      agreementStatus: agreement?.status ?? null,
    });
  }
  return out;
}
