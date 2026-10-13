// Idioma del destinatario de un email transaccional.
//
// La única preferencia de idioma guardada hoy es `seller_leads.locale`, que se escribe
// cuando el vendedor pasa el gate de email del paso 1 del listing (en el idioma de la
// página donde lo hizo). Los vendedores anteriores a ese gate y los compradores no tienen
// fila: para ellos el idioma es desconocido y se devuelve null, y cada email decide su
// respaldo (inglés, o bilingüe donde ya lo era). Nunca lanza: un email no debe fallar
// porque esta consulta falló.
import { createService } from "@/lib/supabase/service";

export type EmailLang = "en" | "es";

export async function lookupRecipientLang(userId: string | null | undefined): Promise<EmailLang | null> {
  if (!userId) return null;
  try {
    const { data } = await createService()
      .from("seller_leads")
      .select("locale")
      .eq("user_id", userId)
      .maybeSingle();
    const locale = (data as { locale?: string } | null)?.locale;
    return locale === "es" || locale === "en" ? locale : null;
  } catch {
    return null;
  }
}
