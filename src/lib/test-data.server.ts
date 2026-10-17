import { createService } from "@/lib/supabase/service";
import { writtenOutsideProduction } from "@/lib/test-data";

/**
 * Una propiedad creada fuera de Production es una prueba. El vendedor no puede insertarla
 * con is_test = true (guard_properties_seller_columns: solo admin o service_role), así que
 * la marca el servidor con la secret key, justo después de crearla. Nunca lanza.
 */
export async function markPropertyIfOutsideProduction(propertyId: string): Promise<void> {
  if (!writtenOutsideProduction(process.env.VERCEL_ENV)) return;
  try {
    const { error } = await createService()
      .from("properties")
      .update({ is_test: true })
      .eq("id", propertyId);
    if (error) console.error("is_test mark failed", error.message);
  } catch (e) {
    console.error("is_test mark failed", e);
  }
}
