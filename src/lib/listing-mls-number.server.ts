// Escritura de `properties.mls_number` y de la tarea que la recuerda. Lo usan los dos
// caminos de aprobación del admin (aprobación rápida en /admin y revisión completa en
// /admin/listings/[id]/review) y el formulario para anotarlo más tarde.
//
// Recibe el cliente de la SESIÓN del admin/broker, no el service-role: RLS y el trigger
// `guard_properties_mls_number` (migración 20260926120100) siguen aplicando, así que un
// no-broker no puede escribir aunque llegara hasta aquí.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ENTER_MLS_NUMBER_TASK, parseMlsNumber } from "@/lib/listing-mls-number";

export type SaveMlsNumberError = "invalid_format" | "empty" | "taken" | "failed";

/** Código de Postgres para violación de UNIQUE (`properties_mls_number_key`). */
const UNIQUE_VIOLATION = "23505";

export function mapMlsNumberWriteError(err: { code?: string } | null): SaveMlsNumberError | null {
  if (!err) return null;
  return err.code === UNIQUE_VIOLATION ? "taken" : "failed";
}

/**
 * Crea la tarea "anotar número MLS" para un listing recién aprobado, salvo que ya haya
 * una pendiente. Best-effort: la aprobación no se revierte si la tarea falla.
 */
export async function ensureEnterMlsNumberTask(
  supabase: SupabaseClient,
  propertyId: string,
  address: string,
): Promise<void> {
  const { data: existente } = await supabase
    .from("broker_tasks")
    .select("id")
    .eq("property_id", propertyId)
    .eq("task_type", ENTER_MLS_NUMBER_TASK)
    .in("status", ["pending", "in_progress"])
    .limit(1)
    .maybeSingle();
  if (existente) return;

  const { error } = await supabase.from("broker_tasks").insert({
    property_id: propertyId,
    task_type: ENTER_MLS_NUMBER_TASK,
    title: `Enter MLS number: ${address}`,
    description:
      "After entering this listing in Matrix, record its MLS number on the listing's " +
      "review page. Without it, /properties can show the listing twice (ours + the IDX feed).",
    priority: "medium",
    status: "pending",
  });
  if (error) {
    console.error(JSON.stringify({ event: "enter_mls_number_task_failed", propertyId, message: error.message }));
  }
}

/** Cierra las tareas pendientes de "anotar número MLS" de un listing. */
export async function completeEnterMlsNumberTasks(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<void> {
  await supabase
    .from("broker_tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("property_id", propertyId)
    .eq("task_type", ENTER_MLS_NUMBER_TASK)
    .in("status", ["pending", "in_progress"]);
}

/**
 * Guarda el número de MLS de un listing propio (anotarlo más tarde o corregirlo). Valida
 * el formato, traduce el UNIQUE a `taken`, cierra la tarea pendiente y deja rastro en
 * activity_log.
 */
export async function saveListingMlsNumber(
  supabase: SupabaseClient,
  args: { propertyId: string; raw: string; userId: string },
): Promise<{ ok: true; value: string } | { ok: false; error: SaveMlsNumberError }> {
  const parsed = parseMlsNumber(args.raw);
  if (!parsed.ok) return { ok: false, error: parsed.reason };

  const { data, error } = await supabase
    .from("properties")
    .update({ mls_number: parsed.value })
    .eq("id", args.propertyId)
    .select("id")
    .maybeSingle();
  const mapped = mapMlsNumberWriteError(error);
  if (mapped) return { ok: false, error: mapped };
  if (!data) return { ok: false, error: "failed" };

  await completeEnterMlsNumberTasks(supabase, args.propertyId);
  await supabase.from("activity_log").insert({
    user_id: args.userId,
    property_id: args.propertyId,
    action_type: "mls_number_set",
    description: `MLS number → ${parsed.value}`,
  });
  return { ok: true, value: parsed.value };
}
