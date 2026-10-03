// Proveedor falso del feed. Lo usa cada test del worker y del cruce de deduplicación:
// sin red, sin credenciales, determinista.
//
// Modela los comportamientos que el adaptador real SÍ tiene y que son la fuente de los
// errores difíciles: paginación con cursor, devolver solo lo modificado después de
// `since`, y —sobre todo— el FILTRO DE ESTADO Y TIPO en la consulta. Sin ese filtro el
// fake entregaría las fichas que pasan a Closed y escondería justo el bug que obliga a
// tener la consulta de bajas: en el feed real, esas fichas dejan de llegar.
//
// `listings` se lee en cada llamada, así que un test puede mutar el arreglo entre
// invocaciones para simular cambios de estado o borrados en el feed.
import { markAsMlsLicensed } from "@/lib/mls/licensed-content";
import type {
  MlsFeedPage, MlsFeedProvider, MlsKeyPage, ResoKeyRecord, ResoListing,
} from "@/lib/mls/feed-port";
import { PUBLICLY_DISPLAYABLE_STATUSES } from "@/lib/mls/display-compliance";
import { SUPPORTED_PROPERTY_TYPES } from "@/lib/mls/coverage";

export interface FakeFeedOptions {
  dataset?: string;
  /** Registros por página. Bridge tope 2.000 en /replication; aquí pequeño a propósito. */
  pageSize?: number;
  /** Fallo inyectado en la n-ésima llamada (1-indexado), para probar reanudación. */
  failOnCall?: number;
}

/** El `$filter` positivo de estado + tipo que manda el adaptador real. */
export function passesIngestFilter(l: { StandardStatus?: unknown; PropertyType?: unknown }): boolean {
  return (PUBLICLY_DISPLAYABLE_STATUSES as readonly unknown[]).includes(l.StandardStatus) &&
    (SUPPORTED_PROPERTY_TYPES as readonly unknown[]).includes(l.PropertyType);
}

const modificadoDespuésDe = (l: ResoListing, since: Date | null) => {
  if (!since) return true;
  const ts = l.ModificationTimestamp;
  return typeof ts === "string" && new Date(ts) > since;
};

export function createFakeFeedProvider(
  listings: ResoListing[],
  opts: FakeFeedOptions = {},
): MlsFeedProvider & { callCount: () => number } {
  const pageSize = opts.pageSize ?? 2;
  let calls = 0;

  // Orden ascendente por ModificationTimestamp, recalculado en cada llamada para ver las
  // mutaciones del test.
  const ordenados = () => [...listings].sort((a, b) =>
    String(a.ModificationTimestamp ?? "").localeCompare(String(b.ModificationTimestamp ?? "")),
  );

  function paginar<T>(elegibles: T[], cursor: string | null): { pagina: T[]; nextCursor: string | null } {
    calls += 1;
    if (opts.failOnCall === calls) throw new Error("fallo inyectado del proveedor");
    // El cursor es opaco para el llamador; aquí resulta ser un offset.
    const offset = cursor ? Number.parseInt(cursor, 10) : 0;
    const siguiente = offset + pageSize;
    return {
      pagina: elegibles.slice(offset, siguiente),
      nextCursor: siguiente < elegibles.length ? String(siguiente) : null,
    };
  }

  const proyectar = (l: ResoListing, campos: readonly string[]): ResoKeyRecord =>
    Object.fromEntries(campos.filter((c) => c in l).map((c) => [c, l[c]])) as ResoKeyRecord;

  return {
    dataset: opts.dataset ?? "fake",
    callCount: () => calls,

    async fetchModifiedSince(since: Date | null, cursor: string | null): Promise<MlsFeedPage> {
      const { pagina, nextCursor } = paginar(
        ordenados().filter((l) => passesIngestFilter(l) && modificadoDespuésDe(l, since)), cursor);
      return { listings: pagina.map((l) => markAsMlsLicensed(l)), nextCursor };
    },

    async fetchRemovedKeysSince(since: Date, cursor: string | null): Promise<MlsKeyPage> {
      const { pagina, nextCursor } = paginar(
        ordenados().filter((l) => !passesIngestFilter(l) && modificadoDespuésDe(l, since)), cursor);
      return {
        keys: pagina.map((l) => markAsMlsLicensed(
          proyectar(l, ["ListingKey", "StandardStatus", "PropertyType"]))),
        nextCursor,
      };
    },

    async fetchDisplayableKeys(cursor: string | null): Promise<MlsKeyPage> {
      const { pagina, nextCursor } = paginar(ordenados().filter(passesIngestFilter), cursor);
      return {
        keys: pagina.map((l) => markAsMlsLicensed(proyectar(l,
          ["ListingKey", "StandardStatus", "PropertyType", "CountyOrParish", "StateOrProvince"]))),
        nextCursor,
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
