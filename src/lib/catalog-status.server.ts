// ¿Tiene /properties algo que mostrar? Sí si hay un listing propio activo (no de prueba) o si
// el IDX puede mostrarse en este host (mismo gate que /properties, ADR-0013). Ante cualquier
// error responde false: el comprador va al formulario, nunca a un catálogo vacío.
import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { mlsDisplayDecision, readMlsGateEnv } from "@/lib/mls/environment-gate";

export const catalogHasListings = cache(async (): Promise<boolean> => {
  try {
    const host = (await headers()).get("host");
    if (mlsDisplayDecision(host, readMlsGateEnv()).allowed) return true;
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("mls_status", "active")
      .eq("is_test", false);
    if (error) return false;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
});
