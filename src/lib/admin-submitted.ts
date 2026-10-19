// Fecha en que el vendedor envió el listing a revisión: la última vez que entró en
// `pending_approval` (property_status_history, la escribe un trigger en cada cambio de
// estado). No es `updated_at`, que cambia con cualquier edición posterior.

export interface StatusHistoryRow {
  property_id: string;
  new_status: string | null;
  changed_at: string;
}

/** property_id → fecha de la última entrada en pending_approval. */
export function submittedAtByProperty(rows: StatusHistoryRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.new_status !== "pending_approval") continue;
    const prev = out.get(r.property_id);
    if (!prev || r.changed_at > prev) out.set(r.property_id, r.changed_at);
  }
  return out;
}
