import type { SupabaseClient } from "@supabase/supabase-js";
import { submittedAtByProperty, type StatusHistoryRow } from "@/lib/admin-submitted";

/**
 * Fecha de envío a revisión de cada listing (ver admin-submitted.ts). Lee con la sesión del
 * staff (RLS: is_admin_or_broker). Si la lectura falla, un mapa vacío: la página muestra "—".
 */
export async function fetchSubmittedAt(db: SupabaseClient, propertyIds: string[]): Promise<Map<string, string>> {
  if (propertyIds.length === 0) return new Map();
  const { data, error } = await db
    .from("property_status_history")
    .select("property_id,new_status,changed_at")
    .in("property_id", propertyIds)
    .eq("new_status", "pending_approval");
  if (error) {
    console.error(JSON.stringify({ event: "admin_submitted_at_failed", message: error.message }));
    return new Map();
  }
  return submittedAtByProperty((data ?? []) as StatusHistoryRow[]);
}
