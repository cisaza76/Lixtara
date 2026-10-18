// Vendedor en la cola de aprobación del admin. `public.users` solo deja leer la fila propia
// (users_select_own), así que con la sesión del admin la columna salía "—" en todos: la
// lectura va con la clave de servicio, después de comprobar el rol (admin-sellers.server.ts).

export interface SellerContact {
  name: string | null;
  email: string | null;
  phone: string | null;
}

interface UserRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

const clean = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
};

export function sellerContactFromRow(row: UserRow): SellerContact {
  return {
    name: clean([row.first_name, row.last_name].filter(Boolean).join(" ")),
    email: clean(row.email),
    phone: clean(row.phone),
  };
}

/** ID corto del listing: distingue dos propiedades con la misma dirección. */
export function shortListingId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}
