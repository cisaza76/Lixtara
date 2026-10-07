// Escritura de las solicitudes del vendedor (#134, #136).
//
// createListingRequest: la llama el endpoint DESPUÉS de verificar sesión, dueño y estado.
//   Recibe el cliente service_role: el vendedor no tiene INSERT sobre listing_requests ni
//   sobre broker_tasks (RLS), y no debe tenerlo — así no puede saltarse la validación.
// approve / reject: las llama /admin con el cliente de la SESIÓN de la broker: RLS
//   (is_admin_or_broker) y guard_properties_seller_columns siguen aplicando.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BROKER_TASK_TYPE,
  describeChanges,
  propertyUpdateFromChanges,
  type ChangeSet,
  type ListingRequestKind,
} from "@/lib/listing-requests";

/** Código de Postgres para violación de UNIQUE (una pendiente por listing y tipo). */
const UNIQUE_VIOLATION = "23505";

export type CreateRequestResult =
  | { ok: true; id: string; taskId: string | null }
  | { ok: false; error: "request_pending" | "insert_failed" };

export async function createListingRequest(
  svc: SupabaseClient,
  args: {
    kind: ListingRequestKind;
    propertyId: string;
    userId: string;
    address: string;
    changes?: ChangeSet;
    reason: string | null;
  },
): Promise<CreateRequestResult> {
  const changes = args.kind === "change" ? (args.changes ?? {}) : {};
  const { data: req, error } = await svc
    .from("listing_requests")
    .insert({
      property_id: args.propertyId,
      kind: args.kind,
      changes,
      reason: args.reason,
      requested_by: args.userId,
    })
    .select("id")
    .single();
  if (error?.code === UNIQUE_VIOLATION) return { ok: false, error: "request_pending" };
  if (error || !req) {
    console.error(JSON.stringify({ event: "listing_request_insert_failed", kind: args.kind, propertyId: args.propertyId, message: error?.message }));
    return { ok: false, error: "insert_failed" };
  }

  const summary =
    args.kind === "change"
      ? `Seller requests: ${describeChanges(changes)}`
      : "Seller requests to withdraw this listing.";
  const description = [
    summary,
    args.reason ? `Reason: ${args.reason}` : null,
    args.kind === "change"
      ? "Update Matrix first, then approve the request on the listing's review page — only then is it applied on lixtara.com."
      : "Withdraw it in Matrix first, then approve the request on the listing's review page.",
  ]
    .filter(Boolean)
    .join("\n");

  // Tarea: best-effort. La solicitud ya existe y se ve en la página de revisión aunque la
  // tarea falle.
  const { data: task, error: taskError } = await svc
    .from("broker_tasks")
    .insert({
      property_id: args.propertyId,
      task_type: BROKER_TASK_TYPE[args.kind],
      title: args.kind === "change" ? `Listing change request — ${args.address}` : `Withdrawal request — ${args.address}`,
      description,
      priority: args.kind === "withdrawal" ? "high" : "medium",
      status: "pending",
    })
    .select("id")
    .single();
  if (taskError) {
    console.error(JSON.stringify({ event: "listing_request_task_failed", requestId: req.id, message: taskError.message }));
  } else if (task) {
    await svc.from("listing_requests").update({ broker_task_id: task.id }).eq("id", req.id);
  }

  await svc.from("activity_log").insert({
    user_id: args.userId,
    property_id: args.propertyId,
    action_type: args.kind === "change" ? "listing_change_requested" : "listing_withdrawal_requested",
    description: summary.slice(0, 1000),
  });

  return { ok: true, id: req.id, taskId: task?.id ?? null };
}

interface PendingRequest {
  id: string;
  property_id: string;
  kind: ListingRequestKind;
  changes: ChangeSet;
  broker_task_id: string | null;
}

export type ReviewResult = { ok: true } | { ok: false; error: "not_pending" | "apply_failed" };

/**
 * Aprueba una solicitud pendiente y la aplica a `properties`. Primero la "reclama"
 * (pending → approved, condicionado a seguir pendiente) para que dos clics no la apliquen
 * dos veces; si la escritura en properties falla, la devuelve a pending.
 */
export async function approveListingRequest(
  supabase: SupabaseClient,
  args: { requestId: string; propertyId: string; reviewerId: string; note: string | null },
): Promise<ReviewResult> {
  const { data: claimed } = await supabase
    .from("listing_requests")
    .update({ status: "approved", reviewed_by: args.reviewerId, reviewed_at: new Date().toISOString(), review_note: args.note })
    .eq("id", args.requestId)
    .eq("property_id", args.propertyId)
    .eq("status", "pending")
    .select("id,property_id,kind,changes,broker_task_id")
    .maybeSingle();
  if (!claimed) return { ok: false, error: "not_pending" };
  const req = claimed as PendingRequest;

  const update =
    req.kind === "withdrawal" ? { mls_status: "withdrawn" } : propertyUpdateFromChanges(req.changes);
  const { data: applied, error } = await supabase
    .from("properties")
    .update(update)
    .eq("id", req.property_id)
    .select("id")
    .maybeSingle();
  if (error || !applied) {
    await supabase
      .from("listing_requests")
      .update({ status: "pending", reviewed_by: null, reviewed_at: null, review_note: null })
      .eq("id", req.id);
    console.error(JSON.stringify({ event: "listing_request_apply_failed", requestId: req.id, message: error?.message }));
    return { ok: false, error: "apply_failed" };
  }

  await closeTask(supabase, req.broker_task_id);
  if (req.kind === "withdrawal") {
    // Un listing retirado no tiene cambios que revisar.
    await supabase
      .from("listing_requests")
      .update({ status: "cancelled", reviewed_by: args.reviewerId, reviewed_at: new Date().toISOString(), review_note: "Listing withdrawn" })
      .eq("property_id", req.property_id)
      .eq("kind", "change")
      .eq("status", "pending");
  }
  await supabase.from("activity_log").insert({
    user_id: args.reviewerId,
    property_id: req.property_id,
    action_type: req.kind === "change" ? "listing_change_approved" : "listing_withdrawn",
    description: (req.kind === "change" ? describeChanges(req.changes) : "Listing → withdrawn (seller request)").slice(0, 1000),
  });
  return { ok: true };
}

export async function rejectListingRequest(
  supabase: SupabaseClient,
  args: { requestId: string; propertyId: string; reviewerId: string; note: string | null },
): Promise<ReviewResult> {
  const { data: rejected } = await supabase
    .from("listing_requests")
    .update({ status: "rejected", reviewed_by: args.reviewerId, reviewed_at: new Date().toISOString(), review_note: args.note })
    .eq("id", args.requestId)
    .eq("property_id", args.propertyId)
    .eq("status", "pending")
    .select("id,kind,broker_task_id")
    .maybeSingle();
  if (!rejected) return { ok: false, error: "not_pending" };

  await closeTask(supabase, rejected.broker_task_id as string | null);
  await supabase.from("activity_log").insert({
    user_id: args.reviewerId,
    property_id: args.propertyId,
    action_type: rejected.kind === "change" ? "listing_change_rejected" : "listing_withdrawal_rejected",
    description: (args.note ?? "Request rejected").slice(0, 1000),
  });
  return { ok: true };
}

async function closeTask(supabase: SupabaseClient, taskId: string | null): Promise<void> {
  if (!taskId) return;
  await supabase
    .from("broker_tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", taskId)
    .in("status", ["pending", "in_progress"]);
}
