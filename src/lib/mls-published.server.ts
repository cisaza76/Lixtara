// Escritura de `properties.mls_published_at` desde el admin. Recibe el cliente de la SESIÓN
// del admin/broker, no el service-role: el guard de la migración 20261018170000 rechaza al
// service_role y exige la sesión de una broker o un admin (quién queda en
// property_status_history.changed_by).
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMlsNumber } from "@/lib/listing-mls-number";
import { completeEnterMlsNumberTasks } from "@/lib/listing-mls-number.server";
import { MIN_CORRECTION_NOTE, mapMlsPublishedWriteError, type MlsPublishedWriteError } from "@/lib/mls-published";

export type MarkPublishedError = MlsPublishedWriteError | "invalid_format" | "empty";

/**
 * "Mark as published on the MLS": guarda el número de MLS y la fecha de publicación (ahora) en
 * la misma escritura. Solo si aún no tenía fecha; la base valida acuerdo y pago.
 */
export async function markListingMlsPublished(
  supabase: SupabaseClient,
  args: { propertyId: string; rawMlsNumber: string; userId: string },
): Promise<{ ok: true; publishedAt: string } | { ok: false; error: MarkPublishedError }> {
  const mls = parseMlsNumber(args.rawMlsNumber);
  if (!mls.ok) return { ok: false, error: mls.reason === "empty" ? "mls_number_required" : mls.reason };

  const publishedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("properties")
    .update({ mls_number: mls.value, mls_published_at: publishedAt })
    .eq("id", args.propertyId)
    .is("mls_published_at", null)
    .select("id")
    .maybeSingle();
  const mapped = mapMlsPublishedWriteError(error);
  if (mapped) return { ok: false, error: mapped };
  if (!data) return { ok: false, error: "already_published" };

  await completeEnterMlsNumberTasks(supabase, args.propertyId);
  await supabase.from("activity_log").insert({
    user_id: args.userId,
    property_id: args.propertyId,
    action_type: "mls_published_marked",
    description: `Published on the MLS (${mls.value})`,
  });
  return { ok: true, publishedAt };
}

/** Corrección de la fecha por un admin, con nota (RPC correct_property_mls_published_at). */
export async function correctListingMlsPublished(
  supabase: SupabaseClient,
  args: { propertyId: string; publishedAt: string | null; note: string; userId: string },
): Promise<{ ok: true } | { ok: false; error: MlsPublishedWriteError }> {
  const note = args.note.trim().slice(0, 2000);
  if (note.length < MIN_CORRECTION_NOTE) return { ok: false, error: "note_required" };

  const { error } = await supabase.rpc("correct_property_mls_published_at", {
    p_property_id: args.propertyId,
    p_published_at: args.publishedAt,
    p_note: note,
  });
  const mapped = mapMlsPublishedWriteError(error);
  if (mapped) return { ok: false, error: mapped };

  await supabase.from("activity_log").insert({
    user_id: args.userId,
    property_id: args.propertyId,
    action_type: "mls_published_corrected",
    description: `MLS publication date → ${args.publishedAt ?? "cleared"}. Note: ${note}`,
  });
  return { ok: true };
}
