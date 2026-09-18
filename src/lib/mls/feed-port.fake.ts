// Proveedor falso del feed. Lo usa cada test del worker y del cruce de deduplicación:
// sin red, sin credenciales, determinista.
//
// Modela dos comportamientos que el adaptador real SÍ tiene y que son la fuente de los
// errores difíciles: paginación con cursor, y devolver solo lo modificado después de
// `since`. Un fake que ignorara ambos dejaría pasar exactamente los bugs que importan.
import { markAsMlsLicensed } from "@/lib/mls/licensed-content";
import type { MlsFeedPage, MlsFeedProvider, ResoListing } from "@/lib/mls/feed-port";

export interface FakeFeedOptions {
  dataset?: string;
  /** Registros por página. Bridge tope 2.000 en /replication; aquí pequeño a propósito. */
  pageSize?: number;
  /** Fallo inyectado en la n-ésima llamada (1-indexado), para probar reanudación. */
  failOnCall?: number;
}

export function createFakeFeedProvider(
  listings: ResoListing[],
  opts: FakeFeedOptions = {},
): MlsFeedProvider & { callCount: () => number } {
  const pageSize = opts.pageSize ?? 2;
  let calls = 0;

  // Orden ascendente por ModificationTimestamp: el contrato del puerto.
  const ordenados = [...listings].sort((a, b) =>
    String(a.ModificationTimestamp ?? "").localeCompare(String(b.ModificationTimestamp ?? "")),
  );

  return {
    dataset: opts.dataset ?? "fake",
    callCount: () => calls,
    async fetchModifiedSince(since: Date | null, cursor: string | null): Promise<MlsFeedPage> {
      calls += 1;
      if (opts.failOnCall === calls) throw new Error("fallo inyectado del proveedor");

      // El cursor es opaco para el llamador; aquí resulta ser un offset.
      const offset = cursor ? Number.parseInt(cursor, 10) : 0;

      const elegibles = ordenados.filter((l) => {
        if (!since) return true;
        const ts = l.ModificationTimestamp;
        return typeof ts === "string" && new Date(ts) > since;
      });

      const pagina = elegibles.slice(offset, offset + pageSize);
      const siguiente = offset + pageSize;
      return {
        listings: pagina.map((l) => markAsMlsLicensed(l)),
        nextCursor: siguiente < elegibles.length ? String(siguiente) : null,
      };
    },
  };
}

/** Constructor de fichas para los tests: campos obligatorios puestos, resto sobrescribible. */
export function makeResoListing(over: Partial<ResoListing> & { ListingKey: string }): ResoListing {
  return {
    ListingId: `A${over.ListingKey}`,
    StandardStatus: "Active",
    // Por defecto una ficha ingerible: sin esto, el filtro de tipo excluiría cada
    // fixture y los tests pasarían por la razón equivocada.
    PropertyType: "Residential",
    ModificationTimestamp: "2026-09-16T10:00:00Z",
    ListPrice: 500_000,
    City: "Miami",
    PostalCode: "33130",
    ListOfficeName: "Some Real Estate Firm",
    ListAgentFullName: "Jane Agent",
    ...over,
  };
}
