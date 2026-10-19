import { createService } from "@/lib/supabase/service";
import { sellerContactFromRow, type SellerContact } from "@/lib/admin-sellers";

/**
 * Nombre, correo y teléfono de los vendedores, por id. Usa la clave de servicio: llamar solo
 * después de comprobar que la sesión es del staff (assertStaffWithUser). Si la lectura falla,
 * devuelve un mapa vacío y la cola muestra "—".
 */
export async function fetchSellerContacts(ownerIds: string[]): Promise<Map<string, SellerContact>> {
  const out = new Map<string, SellerContact>();
  const ids = Array.from(new Set(ownerIds.filter(Boolean)));
  if (ids.length === 0) return out;
  const svc = createService();
  const { data, error } = await svc
    .from("users")
    .select("id,first_name,last_name,email,phone")
    .in("id", ids);
  if (error) {
    console.error("admin: seller contacts read failed", error.message);
    return out;
  }
  for (const row of data ?? []) out.set(row.id, sellerContactFromRow(row));
  // Sin fila en public.users o sin correo en ella: el correo de la cuenta (Auth).
  await Promise.all(
    ids
      .filter((id) => !out.get(id)?.email)
      .map(async (id) => {
        const { data: auth } = await svc.auth.admin.getUserById(id).catch(() => ({ data: { user: null } }));
        const email = auth.user?.email ?? null;
        if (email) out.set(id, { ...(out.get(id) ?? { name: null, phone: null }), email });
      }),
  );
  return out;
}
