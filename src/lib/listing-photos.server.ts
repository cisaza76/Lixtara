import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ¿Esta propiedad tiene el extra de fotografía profesional PAGADO? Lo registra
 * /api/checkout/photography como un pago de la propiedad sin plan (`tier` null; los pagos
 * de plan llevan tier) y el webhook de Stripe lo marca `succeeded`. Ninguna otra compra
 * (consultas, staging) escribe en `payments`. RLS: el vendedor solo ve sus propios pagos.
 */
export async function hasPaidPhotography(db: SupabaseClient, propertyId: string): Promise<boolean> {
  const { data, error } = await db
    .from("payments")
    .select("id")
    .eq("property_id", propertyId)
    .is("tier", null)
    .eq("status", "succeeded")
    .limit(1);
  if (error) {
    console.error("photography payment lookup failed", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}
