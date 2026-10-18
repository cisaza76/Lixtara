import type { SupabaseClient } from "@supabase/supabase-js";

// La oferta al agente del comprador no se lee de `properties` con la clave pública: anon y
// authenticated no tienen SELECT sobre esas columnas (migración 20261017150000, sección 5).
// get_property_buyer_comp() (security definer) se la devuelve solo al dueño, admin o broker.

export interface BuyerCompRecord {
  buyer_agent_comp_type: string | null;
  buyer_agent_commission: number | null;
  buyer_agent_comp_amount: number | null;
  buyer_agent_comp_terms_version: string | null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Oferta guardada del listado, o null si no hay o quien pregunta no es el dueño ni staff. */
export async function fetchBuyerComp(supabase: SupabaseClient, propertyId: string): Promise<BuyerCompRecord | null> {
  const { data, error } = await supabase.rpc("get_property_buyer_comp", { p_property_id: propertyId });
  if (error) throw new Error(`get_property_buyer_comp: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!row) return null;
  return {
    buyer_agent_comp_type: (row.buyer_agent_comp_type as string | null) ?? null,
    buyer_agent_commission: num(row.buyer_agent_commission),
    buyer_agent_comp_amount: num(row.buyer_agent_comp_amount),
    buyer_agent_comp_terms_version: (row.buyer_agent_comp_terms_version as string | null) ?? null,
  };
}
