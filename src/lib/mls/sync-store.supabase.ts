// Implementación del SyncStore contra Supabase. Cliente SERVICE-ROLE: `mls_listings` y
// `mls_sync_state` tienen RLS deny-all, así que ningún otro cliente puede leerlas ni
// escribirlas — ver la migración 20260916140000.
import { createService } from "@/lib/supabase/service";
import type { NormalizedListing } from "@/lib/mls/feed-port";
import type { SyncPassPhase, SyncState, SyncStore } from "@/lib/mls/sync-run";

export function createSupabaseSyncStore(): SyncStore {
  const db = createService();

  return {
    async readState(dataset: string): Promise<SyncState | null> {
      const { data, error } = await db
        .from("mls_sync_state")
        .select("dataset,last_modification_ts,resume_cursor,pass_started_at,pass_phase,removal_cursor")
        .eq("dataset", dataset)
        .maybeSingle();
      if (error) throw new Error(`no se pudo leer mls_sync_state: ${error.message}`);
      if (!data) return null;
      return {
        dataset: data.dataset,
        lastModificationTs: data.last_modification_ts,
        passStartedAt: data.pass_started_at ?? null,
        passPhase: (data.pass_phase === "removals" ? "removals" : "listings") as SyncPassPhase,
        resumeCursor: data.resume_cursor ?? null,
        removalCursor: data.removal_cursor ?? null,
      };
    },

    async upsertListings(rows: NormalizedListing[]): Promise<number> {
      if (rows.length === 0) return 0;
      // `last_seen_at` se refresca en cada pasada; `first_seen_at` conserva su default
      // en el INSERT y no se toca en el UPDATE.
      const ahora = new Date().toISOString();
      const { error } = await db
        .from("mls_listings")
        .upsert(rows.map((r) => ({ ...r, last_seen_at: ahora })), {
          onConflict: "listing_key",
        });
      if (error) throw new Error(`no se pudo hacer upsert de listings: ${error.message}`);
      return rows.length;
    },

    async deleteListings(dataset, listingKeys): Promise<number> {
      if (listingKeys.length === 0) return 0;
      // RPC y no `.delete().in()`: una página de bajas trae hasta 2.000 claves, que no
      // caben en la URL de PostgREST. La función suma también el total acumulado.
      const { data, error } = await db.rpc("mls_delete_listings", {
        p_dataset: dataset, p_keys: listingKeys,
      });
      // Lanza: una baja que no se aplica deja visible una ficha que ya no debe estarlo.
      if (error) throw new Error(`no se pudieron borrar listings: ${error.message}`);
      return typeof data === "number" ? data : 0;
    },

    async commitCursor(dataset, lastModificationTs, recordsSeen): Promise<void> {
      const { error } = await db.from("mls_sync_state").upsert(
        {
          dataset,
          last_modification_ts: lastModificationTs,
          // Pasada completa: ya no hay dónde reanudar.
          resume_cursor: null,
          removal_cursor: null,
          pass_started_at: null,
          pass_phase: "listings",
          last_run_at: new Date().toISOString(),
          last_run_status: "ok",
          last_error: null,
          records_seen: recordsSeen,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "dataset" },
      );
      if (error) throw new Error(`no se pudo avanzar el cursor: ${error.message}`);
    },

    async saveProgress(dataset, p): Promise<void> {
      const { error } = await db.from("mls_sync_state").upsert(
        {
          dataset,
          pass_started_at: p.passStartedAt,
          pass_phase: p.passPhase,
          resume_cursor: p.resumeCursor,
          removal_cursor: p.removalCursor,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "dataset" },
      );
      // Sí lanza: perder el cursor significa que la próxima pasada reempieza desde cero,
      // y con 1,4 M de fichas eso es la diferencia entre converger y no converger.
      if (error) throw new Error(`no se pudo guardar el cursor de reanudación: ${error.message}`);
    },

    async recordRun(dataset, status, error): Promise<void> {
      // Nunca lanza: registrar el resultado no puede ser lo que tumbe la pasada. Un
      // fallo aquí se traga y se loguea; el estado real ya está en las filas insertadas.
      const { error: err } = await db.from("mls_sync_state").upsert(
        {
          dataset,
          last_run_at: new Date().toISOString(),
          last_run_status: status,
          // Se recorta: un stack largo no aporta y podría arrastrar contenido licenciado.
          last_error: error ? error.slice(0, 500) : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "dataset" },
      );
      if (err) console.error(JSON.stringify({ event: "mls_sync_record_run_failed", dataset, message: err.message }));
    },
  };
}
