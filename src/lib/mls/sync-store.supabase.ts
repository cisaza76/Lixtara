// Implementación del SyncStore contra Supabase. Cliente SERVICE-ROLE: `mls_listings` y
// `mls_sync_state` tienen RLS deny-all, así que ningún otro cliente puede leerlas ni
// escribirlas — ver la migración 20260916140000.
import { createService } from "@/lib/supabase/service";
import type { NormalizedListing } from "@/lib/mls/feed-port";
import type { SyncState, SyncStore } from "@/lib/mls/sync-run";

export function createSupabaseSyncStore(): SyncStore {
  const db = createService();

  return {
    async readState(dataset: string): Promise<SyncState | null> {
      const { data, error } = await db
        .from("mls_sync_state")
        .select("dataset,last_modification_ts,resume_cursor")
        .eq("dataset", dataset)
        .maybeSingle();
      if (error) throw new Error(`no se pudo leer mls_sync_state: ${error.message}`);
      if (!data) return null;
      return {
        dataset: data.dataset,
        lastModificationTs: data.last_modification_ts,
        resumeCursor: data.resume_cursor ?? null,
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

    async commitCursor(dataset, lastModificationTs, recordsSeen): Promise<void> {
      const { error } = await db.from("mls_sync_state").upsert(
        {
          dataset,
          last_modification_ts: lastModificationTs,
          // Pasada completa: ya no hay dónde reanudar.
          resume_cursor: null,
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

    async saveResumeCursor(dataset, cursor): Promise<void> {
      const { error } = await db.from("mls_sync_state").upsert(
        { dataset, resume_cursor: cursor, updated_at: new Date().toISOString() },
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
