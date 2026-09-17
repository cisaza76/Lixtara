import { describe, it, expect } from "vitest";
import { mergePublicListings, normalizeMlsNumber, type MlsPublicRow, type OwnListingRef } from "./public-listings";

const fila = (over: Partial<MlsPublicRow> & { listing_id: string }): MlsPublicRow => ({
  listing_key: `K_${over.listing_id}`,
  mls_status: "Active",
  withdrawn_at: null,
  list_price: 500_000,
  city: "Miami",
  postal_code: "33130",
  list_office_name: "Acme Realty",
  list_agent_name: "Jane Agent",
  list_office_phone: null,
  list_office_email: null,
  list_agent_phone: null,
  list_agent_email: null,
  ...over,
});

const propio = (mlsNumber: string | null): OwnListingRef => ({ id: `p_${mlsNumber}`, mlsNumber });

describe("normalizeMlsNumber", () => {
  it("iguala lo tecleado a mano con lo que devuelve el feed", () => {
    // Anamaria lo copia desde Matrix; comparar en crudo fallaría el cruce y la
    // propiedad saldría DUPLICADA en /properties.
    const canon = normalizeMlsNumber("A11234567");
    for (const v of ["a11234567", " A11234567 ", "A11 234 567"]) {
      expect(normalizeMlsNumber(v), v).toBe(canon);
    }
  });

  it("null para lo que no es un número utilizable", () => {
    for (const v of [null, undefined, "", "   "]) expect(normalizeMlsNumber(v)).toBeNull();
  });
});

describe("deduplicación contra listings propios", () => {
  it("suprime del feed lo que ya tenemos en properties", () => {
    // El caso que motiva todo esto: el feed IDX incluye los listings de la propia
    // correduría, así que sin cruzar saldrían dos veces.
    const r = mergePublicListings(
      [propio("A11234567")],
      [fila({ listing_id: "A11234567" }), fila({ listing_id: "A99999999" })],
      "en",
    );
    expect(r.mlsListings.map((l) => l.listingId)).toEqual(["A99999999"]);
    expect(r.suppressed).toEqual([{ listingId: "A11234567", reason: "own_listing" }]);
  });

  it("cruza aunque el formato difiera", () => {
    const r = mergePublicListings([propio(" a11234567 ")], [fila({ listing_id: "A11234567" })], "en");
    expect(r.mlsListings).toHaveLength(0);
    expect(r.suppressed[0].reason).toBe("own_listing");
  });

  it("un listing propio sin mls_number anotado no suprime nada", () => {
    // Estado real hoy: mls_number no se escribe en ninguna parte. Hasta que Anamaria lo
    // anote, esa propiedad sale dos veces — y eso es correcto y visible, no un fallo
    // silencioso: la alternativa sería suprimir por heurística de dirección y equivocarse.
    const r = mergePublicListings([propio(null)], [fila({ listing_id: "A11234567" })], "en");
    expect(r.mlsListings).toHaveLength(1);
    expect(r.suppressed).toHaveLength(0);
  });

  it("no suprime de más: varios propios, un solo match", () => {
    const r = mergePublicListings(
      [propio("A1"), propio("A2"), propio(null)],
      [fila({ listing_id: "A2" }), fila({ listing_id: "A3" })],
      "en",
    );
    expect(r.mlsListings.map((l) => l.listingId)).toEqual(["A3"]);
  });
});

describe("elegibilidad de exhibición", () => {
  it("suprime lo retirado del feed", () => {
    const r = mergePublicListings([], [fila({ listing_id: "A1", withdrawn_at: "2026-09-17T00:00:00Z" })], "en");
    expect(r.mlsListings).toHaveLength(0);
    expect(r.suppressed[0].reason).toBe("withdrawn");
  });

  it("suprime los estados que no van al buscador público", () => {
    for (const s of ["Closed", "Expired", "Withdrawn", "Canceled"]) {
      const r = mergePublicListings([], [fila({ listing_id: "A1", mls_status: s })], "en");
      expect(r.mlsListings, s).toHaveLength(0);
      expect(r.suppressed[0].reason).toBe("not_displayable");
    }
  });

  it("deja pasar los estados públicos de IDX", () => {
    for (const s of ["Active", "Active Under Contract", "Pending", "Coming Soon"]) {
      expect(mergePublicListings([], [fila({ listing_id: "A1", mls_status: s })], "en").mlsListings, s)
        .toHaveLength(1);
    }
  });

  it("lo propio se descarta ANTES de mirar el estado", () => {
    // Renderizar desde `properties` es siempre preferible: tiene las fotos del vendedor,
    // el staging y el video. El estado del feed no cambia eso.
    const r = mergePublicListings([propio("A1")], [fila({ listing_id: "A1", mls_status: "Closed" })], "en");
    expect(r.suppressed[0].reason).toBe("own_listing");
  });
});

describe("atribución obligatoria (Schedule A §9)", () => {
  it("toda ficha de tercero que se muestra lleva atribución", () => {
    // Es la obligación contractual más visible desde fuera. Si esto se rompe, se rompe
    // en producción y lo ve el MLS.
    const r = mergePublicListings([], [
      fila({ listing_id: "A1", list_office_name: "Acme Realty" }),
      fila({ listing_id: "A2", list_office_name: "Otra Firma" }),
    ], "en");
    expect(r.mlsListings).toHaveLength(2);
    for (const l of r.mlsListings) {
      expect(l.attribution.courtesyLine).toBeTruthy();
      expect(l.attribution.courtesyLine).toContain("This listing is courtesy of");
    }
  });

  it("atribuye en español cuando el locale es es", () => {
    const r = mergePublicListings([], [fila({ listing_id: "A1" })], "es");
    expect(r.mlsListings[0].attribution.courtesyLine).toContain("Este listado es cortesía de");
  });

  it("sin nombre de oficina sigue atribuyendo: omitirla ES el incumplimiento", () => {
    const r = mergePublicListings([], [fila({ listing_id: "A1", list_office_name: null })], "en");
    expect(r.mlsListings[0].attribution.courtesyLine).toContain("another real estate firm");
  });

  it("incluye los campos extra que el feed traiga", () => {
    const r = mergePublicListings([], [fila({
      listing_id: "A1", list_agent_name: "Jane Agent", list_office_phone: "305-555-0100",
    })], "en");
    expect(r.mlsListings[0].attribution.extraFields).toContain("Jane Agent");
    expect(r.mlsListings[0].attribution.extraFields).toContain("305-555-0100");
  });
});

describe("casos límite", () => {
  it("feed vacío y propios vacíos", () => {
    expect(mergePublicListings([], [], "en")).toEqual({ mlsListings: [], suppressed: [] });
  });

  it("todo el feed es nuestro: no queda nada de terceros", () => {
    const r = mergePublicListings([propio("A1"), propio("A2")],
      [fila({ listing_id: "A1" }), fila({ listing_id: "A2" })], "en");
    expect(r.mlsListings).toHaveLength(0);
    expect(r.suppressed).toHaveLength(2);
  });
});
