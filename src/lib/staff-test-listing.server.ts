// Vista de un listado `is_test` para el staff (CLAUDE.md "Test data"): la ficha pública
// (getPropertyById, src/lib/properties.ts) excluye siempre los de prueba y solo muestra
// activos; un listado de prueba nunca llega a activo. Para probar en producción la ficha y la
// solicitud de visita, el staff ve aquí el listado de prueba en cualquier estado, con la marca
// TEST. Solo se llama después de comprobar que quien pide es staff.
import { createService } from "@/lib/supabase/service";
import type { PropertyDetail } from "@/lib/properties";

export async function getStaffTestProperty(id: string): Promise<PropertyDetail | null> {
  const svc = createService();
  const { data: prop } = await svc
    .from("properties")
    .select(
      "id,address_street,address_city,address_state,address_zip,list_price,bedrooms,bathrooms,sqft,property_type,latitude,longitude,year_built,description,mls_status",
    )
    .eq("id", id)
    .eq("is_test", true)
    .maybeSingle();
  if (!prop) return null;
  const { data: photos } = await svc
    .from("property_photos")
    .select("url,is_primary,display_order,is_staged")
    .eq("property_id", id)
    .order("display_order", { ascending: true });
  const primary = photos?.find((p) => p.is_primary)?.url ?? photos?.[0]?.url ?? null;
  return { ...prop, photos: photos ?? [], primary_photo_url: primary } as PropertyDetail;
}
