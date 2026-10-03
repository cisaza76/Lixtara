// Implementación del ReconcileStore contra Supabase. Cliente SERVICE-ROLE: `mls_listings`
// y `mls_sync_state` tienen RLS deny-all, y las funciones de la migración 20260926120000
// solo las ejecuta `service_role`.
import { createService } from "@/lib/supabase/service";
import type { ReconcileState, ReconcileStore } from "@/lib/mls/reconcile-run";

export function createSupabaseReconcileStore(): ReconcileStore {
  const db = createService();
  const ahora = () => new Date().toISOString();

  return {
    async readReconcileState(dataset): Promise<ReconcileState | null> {
      const { data, error } = await db
        .from("mls_sync_state")
        .select("dataset,reconciliation_started_at,reconciliation_cursor,reconciliation_keys_seen,last_reconciliation_at")
        .eq("dataset", dataset)
        .maybeSingle();
      if (error) throw new Error(`no se pudo leer mls_sync_state: ${error.message}`);
      if (!data) return null;
      return {
        dataset: data.dataset,
        startedAt: data.reconciliation_started_at ?? null,
        cursor: data.reconciliation_cursor ?? null,
        keysSeen: Number(data.reconciliation_keys_seen ?? 0),
        lastFinishedAt: data.last_reconciliation_at ?? null,
      };
    },

    async beginReconciliation(dataset, startedAt): Promise<void> {
      const { error } = await db.from("mls_sync_state").upsert(
        {
          dataset,
          reconciliation_started_at: startedAt,
          reconciliation_cursor: null,
          reconciliation_keys_seen: 0,
          updated_at: ahora(),
        },
        { onConflict: "dataset" },
      );
      if (error) throw new Error(`no se pudo abrir la reconciliación: ${error.message}`);
    },

    async confirmListings(listingKeys, at): Promise<number> {
      if (listingKeys.length === 0) return 0;
      // RPC: una página trae hasta 2.000 claves, que no caben en la URL de PostgREST.
      const { data, error } = await db.rpc("mls_confirm_listings", { p_keys: listingKeys, p_at: at });
      if (error) throw new Error(`no se pudieron confirmar claves: ${error.message}`);
      return typeof data === "number" ? data : 0;
    },

    async saveReconcileProgress(dataset, cursor, keysSeen): Promise<void> {
      const { error } = await db
        .from("mls_sync_state")
        .update({ reconciliation_cursor: cursor, reconciliation_keys_seen: keysSeen, updated_at: ahora() })
        .eq("dataset", dataset);
      // Lanza: perder el progreso reempezaría la lista; y cursor y conteo van juntos.
      if (error) throw new Error(`no se pudo guardar el progreso de la reconciliación: ${error.message}`);
    },

    async countListings(): Promise<number> {
      const { count, error } = await db
        .from("mls_listings")
        .select("listing_key", { count: "exact", head: true });
      if (error || count === null) {
        // Sin conteo no se puede evaluar la protección del 80 %: lanzar evita borrar a ciegas.
        throw new Error(`no se pudo contar mls_listings: ${error?.message ?? "count null"}`);
      }
      return count;
    },

    async sweepUnconfirmed(startedAt): Promise<number> {
      const { data, error } = await db.rpc("mls_reconcile_sweep", { p_started_at: startedAt });
      if (error) throw new Error(`falló el barrido de la reconciliación: ${error.message}`);
      return typeof data === "number" ? data : 0;
    },

    async finishReconciliation(dataset, r): Promise<void> {
      const { error } = await db
        .from("mls_sync_state")
        .update({
          reconciliation_started_at: null,
          reconciliation_cursor: null,
          reconciliation_keys_seen: 0,
          last_reconciliation_at: ahora(),
          last_reconciliation_status: r.status,
          last_reconciliation_deleted: r.deleted,
          last_reconciliation_stored: r.stored,
          last_reconciliation_keys_seen: r.keysSeen,
          last_reconciliation_error: r.error ? r.error.slice(0, 500) : null,
          updated_at: ahora(),
        })
        .eq("dataset", dataset);
      if (error) throw new Error(`no se pudo cerrar la reconciliación: ${error.message}`);
    },

    async recordReconcileRun(dataset, status, err): Promise<void> {
      // Nunca lanza: registrar no puede ser lo que tumbe la invocación.
      const { error } = await db
        .from("mls_sync_state")
        .update({
          last_reconciliation_status: status,
          last_reconciliation_error: err ? err.slice(0, 500) : null,
          updated_at: ahora(),
        })
        .eq("dataset", dataset);
      if (error) console.error(JSON.stringify({ event: "mls_reconcile_record_failed", dataset, message: error.message }));
    },
  };
}
