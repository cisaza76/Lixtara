import type { SupabaseClient } from "@supabase/supabase-js";
import { createService } from "@/lib/supabase/service";
import { SITE_URL } from "@/lib/config";
import { sendListingApproved } from "@/lib/email";
import { lookupRecipientLang, type EmailLang } from "@/lib/email-recipient-lang";

// Aprobación de un listing (pending → active) y el correo "tu propiedad está publicada" al
// vendedor. Los dos caminos de aprobación —inicio del admin y /admin/listings/[id]/review—
// pasan por aquí, así el correo sale una sola vez por listing:
//   1. el cambio a `active` es una escritura condicional: solo una llamada lo consigue, aunque
//      se aprueben las dos pantallas a la vez o se reintente (Postgres re-evalúa el WHERE
//      tras el bloqueo de la fila);
//   2. aun así, si property_status_history (lo escribe un trigger en cada cambio de
//      mls_status) muestra una activación anterior, no se reenvía.
// Un listing de prueba (`is_test`) nunca se aprueba ni dispara el correo: las dos escrituras a
// `active` llevan `is_test = false` y el correo lo comprueba otra vez.
// Sin tablas ni columnas nuevas.

/** Código de error de las dos pantallas de aprobación para un listing de prueba. */
export const TEST_LISTING_ERROR = "test_listing";

export function testListingMessage(lang: string): string {
  return lang === "es"
    ? "Listing de prueba: no se puede aprobar ni publicar."
    : "Test listing: it can't be approved or published.";
}

/** ¿Es un listing de prueba? Si no se puede leer, se trata como de prueba (no se aprueba). */
export async function isTestListing(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("properties").select("is_test").eq("id", id).maybeSingle();
  if (error || !data) return true;
  return data.is_test !== false;
}

export type ApprovedEmailResult = "sent" | "already_sent" | "no_email" | "test_listing" | "failed";

export interface ApprovedEmailDeps {
  /** Cuántas veces pasó el listing a `active` (property_status_history). */
  countActivations(propertyId: string): Promise<number>;
  loadListing(propertyId: string): Promise<{
    ownerId: string;
    address: string;
    isTest: boolean;
  } | null>;
  sellerEmail(ownerId: string): Promise<string | null>;
  sellerLang(ownerId: string): Promise<EmailLang | null>;
  send: typeof sendListingApproved;
}

function serviceDeps(): ApprovedEmailDeps {
  const svc = createService();
  return {
    async countActivations(propertyId) {
      const { count, error } = await svc
        .from("property_status_history")
        .select("id", { count: "exact", head: true })
        .eq("property_id", propertyId)
        .eq("new_status", "active");
      if (error) throw error;
      return count ?? 0;
    },
    async loadListing(propertyId) {
      const { data } = await svc
        .from("properties")
        .select("owner_id,address_street,address_city,address_state,address_zip,is_test")
        .eq("id", propertyId)
        .maybeSingle();
      if (!data?.owner_id) return null;
      return {
        ownerId: data.owner_id,
        address: `${data.address_street}, ${data.address_city}, ${data.address_state} ${data.address_zip}`,
        isTest: data.is_test !== false,
      };
    },
    async sellerEmail(ownerId) {
      const { data } = await svc.auth.admin.getUserById(ownerId);
      return data.user?.email ?? null;
    },
    sellerLang: lookupRecipientLang,
    send: sendListingApproved,
  };
}

/**
 * Manda el correo de aprobación si esta es la primera activación del listing. Se llama solo
 * después de que la escritura condicional a `active` devolvió la fila. Best-effort: nunca
 * lanza (la aprobación ya quedó hecha).
 */
export async function notifyListingApprovedOnce(
  propertyId: string,
  deps: ApprovedEmailDeps = serviceDeps(),
): Promise<ApprovedEmailResult> {
  try {
    if ((await deps.countActivations(propertyId)) > 1) return "already_sent";
    const listing = await deps.loadListing(propertyId);
    if (!listing) return "no_email";
    if (listing.isTest) return "test_listing";
    const to = await deps.sellerEmail(listing.ownerId);
    if (!to) return "no_email";
    // En el idioma del vendedor (seller_leads.locale), no en el del staff; si no se sabe, inglés.
    const lang = (await deps.sellerLang(listing.ownerId)) ?? "en";
    await deps.send({
      to,
      lang,
      propertyAddress: listing.address,
      listingUrl: `${SITE_URL}/${lang}/property/${propertyId}`,
    });
    return "sent";
  } catch (e) {
    console.error("listing approved email failed:", e);
    return "failed";
  }
}

/**
 * Escribe el nuevo mls_status desde la revisión del listing. Para `active`, el cambio es
 * condicional (`mls_status <> 'active'`) y `becameActive` dice si ESTA llamada lo hizo: solo
 * entonces se manda el correo. Si ya estaba activo, se guarda igual el número de MLS. Un
 * listing de prueba nunca pasa a `active` (`is_test = false` en las dos escrituras).
 */
export async function writeListingStatus(
  supabase: SupabaseClient,
  id: string,
  newStatus: string,
  mlsNumber: string | null,
): Promise<{ error: { code?: string; message?: string } | null; becameActive: boolean }> {
  if (newStatus === "active") {
    const { data, error } = await supabase
      .from("properties")
      .update(mlsNumber ? { mls_status: newStatus, mls_number: mlsNumber } : { mls_status: newStatus })
      .eq("id", id)
      .eq("is_test", false)
      .neq("mls_status", "active")
      .select("id");
    if (error) return { error, becameActive: false };
    if ((data ?? []).length > 0) return { error: null, becameActive: true };
    const { error: again } = await supabase
      .from("properties")
      .update(mlsNumber ? { mls_status: newStatus, mls_number: mlsNumber } : { mls_status: newStatus })
      .eq("id", id)
      .eq("is_test", false);
    return { error: again, becameActive: false };
  }
  const { error } = await supabase.from("properties").update(mlsNumber ? { mls_status: newStatus, mls_number: mlsNumber } : { mls_status: newStatus }).eq("id", id);
  return { error, becameActive: false };
}
