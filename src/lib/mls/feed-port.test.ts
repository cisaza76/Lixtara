import { describe, it, expect } from "vitest";
import {
  normalizeListing,
  maxModificationTimestamp,
  MlsNormalizationError,
  type ResoListing,
} from "./feed-port";
import { createFakeFeedProvider, makeResoListing } from "./feed-port.fake";

const FALLBACK = "2026-09-16T00:00:00Z";

describe("normalizeListing", () => {
  it("proyecta los campos que el código lee por nombre", () => {
    const n = normalizeListing(makeResoListing({
      ListingKey: "K1", ListingId: "A11234567", ListPrice: 595_000,
      City: "Coral Gables", PostalCode: "33143", Latitude: 25.72, Longitude: -80.27,
      ListOfficeName: "Acme Realty", ListAgentFullName: "Jane Agent",
    }), FALLBACK);
    expect(n.listing_key).toBe("K1");
    expect(n.listing_id).toBe("A11234567");
    expect(n.list_price).toBe(595_000);
    expect(n.city).toBe("Coral Gables");
    expect(n.latitude).toBe(25.72);
    expect(n.list_office_name).toBe("Acme Realty");
  });

  it("conserva el payload completo, incluidos los campos que no modelamos", () => {
    // El payload es la fuente de verdad; las columnas son solo proyección. Un campo del
    // Data Dictionary que hoy no leemos no puede perderse en la ingesta.
    const n = normalizeListing(makeResoListing({
      ListingKey: "K2", PoolPrivateYN: true, ArchitecturalStyle: ["Mediterranean"],
    } as Partial<ResoListing> & { ListingKey: string }), FALLBACK);
    expect(n.payload.PoolPrivateYN).toBe(true);
    expect(n.payload.ArchitecturalStyle).toEqual(["Mediterranean"]);
  });

  it("un campo opcional ausente es null, no un fallo", () => {
    // Un MLS que no publica un campo opcional no es un error de sincronización.
    const n = normalizeListing({
      ListingKey: "K3", ListingId: "A1", StandardStatus: "Active",
      ModificationTimestamp: "2026-09-16T10:00:00Z",
    }, FALLBACK);
    expect(n.list_price).toBeNull();
    expect(n.city).toBeNull();
    expect(n.list_office_name).toBeNull();
  });

  it("trata la cadena vacía y los espacios como ausencia", () => {
    const n = normalizeListing(makeResoListing({
      ListingKey: "K4", City: "   ", ListOfficeName: "",
    }), FALLBACK);
    expect(n.city).toBeNull();
    expect(n.list_office_name).toBeNull();
  });

  it("rechaza números no finitos", () => {
    const n = normalizeListing(makeResoListing({
      ListingKey: "K5", ListPrice: Number.NaN, Latitude: Number.POSITIVE_INFINITY,
    }), FALLBACK);
    expect(n.list_price).toBeNull();
    expect(n.latitude).toBeNull();
  });

  it("usa el fallback cuando el MLS omite ModificationTimestamp", () => {
    // Sin timestamp la fila no se podría ordenar y el cursor dejaría de ser reanudable.
    const n = normalizeListing({
      ListingKey: "K6", ListingId: "A1", StandardStatus: "Active",
    }, FALLBACK);
    expect(n.modification_ts).toBe(FALLBACK);
  });

  it("lanza solo ante las tres claves sin las que la fila no existe", () => {
    const base = { ListingKey: "K7", ListingId: "A1", StandardStatus: "Active" };
    for (const [campo, valor] of [["ListingKey",""],["ListingId",""],["StandardStatus",""]] as const) {
      expect(() => normalizeListing({ ...base, [campo]: valor } as ResoListing, FALLBACK))
        .toThrow(MlsNormalizationError);
    }
  });

  it("el error identifica el listing cuando se conoce", () => {
    try {
      normalizeListing({ ListingKey: "K8", ListingId: "", StandardStatus: "Active" }, FALLBACK);
      expect.unreachable();
    } catch (e) {
      expect((e as MlsNormalizationError).listingKey).toBe("K8");
    }
  });
});

describe("maxModificationTimestamp", () => {
  it("devuelve el máximo — es el valor al que avanza el cursor", () => {
    const ls = ["2026-09-16T08:00:00Z","2026-09-16T12:00:00Z","2026-09-16T10:00:00Z"]
      .map((ts, i) => normalizeListing(makeResoListing({ ListingKey: `K${i}`, ModificationTimestamp: ts }), FALLBACK));
    expect(maxModificationTimestamp(ls)).toBe("2026-09-16T12:00:00Z");
  });

  it("página vacía → null: no hay nada que avanzar", () => {
    expect(maxModificationTimestamp([])).toBeNull();
  });
});

describe("proveedor falso", () => {
  const datos = ["08","09","10","11","12"].map((h) =>
    makeResoListing({ ListingKey: `K${h}`, ModificationTimestamp: `2026-09-16T${h}:00:00Z` }));

  it("pagina con cursor opaco hasta agotar", async () => {
    const p = createFakeFeedProvider(datos, { pageSize: 2 });
    const vistos: string[] = [];
    let cursor: string | null = null;
    do {
      const pag = await p.fetchModifiedSince(null, cursor);
      vistos.push(...pag.listings.map((l) => l.ListingKey));
      cursor = pag.nextCursor;
    } while (cursor);
    expect(vistos).toEqual(["K08","K09","K10","K11","K12"]);
    expect(p.callCount()).toBe(3);
  });

  it("este fake ordena, aunque el contrato NO lo exige", async () => {
    // El puerto no garantiza orden: /replication de Bridge rechaza $orderby. El fake
    // ordena porque es determinista y cómodo, no porque un consumidor pueda asumirlo.
    const desordenados = [...datos].reverse();
    const p = createFakeFeedProvider(desordenados, { pageSize: 10 });
    const pag = await p.fetchModifiedSince(null, null);
    const ts = pag.listings.map((l) => l.ModificationTimestamp as string);
    expect([...ts]).toEqual([...ts].sort());
  });

  it("respeta `since`: solo lo modificado después", async () => {
    const p = createFakeFeedProvider(datos, { pageSize: 10 });
    const pag = await p.fetchModifiedSince(new Date("2026-09-16T10:00:00Z"), null);
    expect(pag.listings.map((l) => l.ListingKey)).toEqual(["K11","K12"]);
  });

  it("puede inyectar un fallo para probar la reanudación", async () => {
    const p = createFakeFeedProvider(datos, { pageSize: 2, failOnCall: 2 });
    await p.fetchModifiedSince(null, null);
    await expect(p.fetchModifiedSince(null, "2")).rejects.toThrow("fallo inyectado");
  });
});
