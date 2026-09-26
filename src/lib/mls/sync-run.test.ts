import { describe, it, expect, vi } from "vitest";
import {
  runMlsSync, syncNeedsAttention, type SyncStore, type SyncState, type SyncProgress,
} from "./sync-run";
import { createFakeFeedProvider, makeResoListing } from "./feed-port.fake";
import type { NormalizedListing } from "./feed-port";

const estadoVacío = (dataset: string, lastModificationTs: string | null): SyncState => ({
  dataset, lastModificationTs, passStartedAt: null, passPhase: "listings",
  resumeCursor: null, removalCursor: null,
});

function createFakeStore(inicial: SyncState | null = null) {
  const filas = new Map<string, NormalizedListing>();
  const commits: Array<{ ts: string; seen: number }> = [];
  const runs: Array<{ status: string; error: string | null }> = [];
  const resumes: Array<SyncProgress> = [];
  const borrados: string[] = [];
  let estado = inicial;
  const store: SyncStore = {
    async readState() { return estado; },
    async upsertListings(rows) { for (const r of rows) filas.set(r.listing_key, r); return rows.length; },
    async deleteListings(_d, keys) {
      let n = 0;
      for (const k of keys) if (filas.delete(k)) { n += 1; borrados.push(k); }
      return n;
    },
    async commitCursor(dataset, ts, seen) {
      commits.push({ ts, seen });
      // commitCursor limpia el progreso, igual que la implementación real.
      estado = estadoVacío(dataset, ts);
    },
    async saveProgress(dataset, progress) {
      resumes.push(progress);
      estado = { dataset, lastModificationTs: estado?.lastModificationTs ?? null, ...progress };
    },
    async recordRun(_d, status, error) { runs.push({ status, error }); },
  };
  return { store, filas, commits, runs, resumes, borrados, estadoActual: () => estado };
}

/** Fichas en los tres condados cubiertos. */
const enCobertura = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    makeResoListing({
      ListingKey: `K${i}`,
      CountyOrParish: ["Miami-Dade", "Broward", "Palm Beach"][i % 3],
      StateOrProvince: "FL",
      ModificationTimestamp: `2026-09-1${i % 9}T10:00:00Z`,
    } as never));

const reloj = (inicio = 1_000_000) => { let t = inicio; return { now: () => t, avanzar: (ms: number) => { t += ms; } }; };

describe("pasada completa", () => {
  it("pagina hasta el final e inserta lo que está en cobertura", async () => {
    const { store, filas, commits, runs } = createFakeStore();
    const r = await runMlsSync({
      provider: createFakeFeedProvider(enCobertura(5), { pageSize: 2 }),
      store, now: () => 1_000_000, timeBudgetMs: 60_000, maxPages: 100,
    });
    expect(r.completed).toBe(true);
    expect(r.stoppedBy).toBe("completed");
    expect(r.pages).toBe(3);
    expect(r.received).toBe(5);
    expect(r.upserted).toBe(5);
    expect(filas.size).toBe(5);
    expect(commits).toHaveLength(1);
    expect(runs).toEqual([{ status: "ok", error: null }]);
  });

  it("el cursor avanza a runStartedAt, NO al máximo visto", async () => {
    // Un registro modificado DURANTE la pasada puede haber aparecido en una página
    // temprana; usar el máximo visto lo saltaría para siempre. El solapamiento que
    // produce runStartedAt se reprocesa sin consecuencias (upsert por listing_key).
    const { store, commits } = createFakeStore();
    const inicio = Date.UTC(2026, 8, 17, 12, 0, 0);
    await runMlsSync({
      provider: createFakeFeedProvider(enCobertura(3), { pageSize: 10 }),
      store, now: () => inicio, timeBudgetMs: 60_000, maxPages: 100,
    });
    expect(commits[0].ts).toBe(new Date(inicio).toISOString());
    // El máximo visto en los datos es 2026-09-1x, distinto del sello de la pasada.
    expect(commits[0].ts).not.toContain("2026-09-12T10:00");
  });

  it("aplica `since` del estado previo", async () => {
    const { store } = createFakeStore(estadoVacío("fake", "2026-09-15T00:00:00Z"));
    const datos = [
      makeResoListing({ ListingKey: "viejo", CountyOrParish: "Broward", ModificationTimestamp: "2026-09-10T10:00:00Z" } as never),
      makeResoListing({ ListingKey: "nuevo", CountyOrParish: "Broward", ModificationTimestamp: "2026-09-16T10:00:00Z" } as never),
    ];
    const r = await runMlsSync({
      provider: createFakeFeedProvider(datos, { pageSize: 10 }),
      store, now: () => 1_000_000, timeBudgetMs: 60_000, maxPages: 100,
    });
    expect(r.received).toBe(1);
    expect(r.upserted).toBe(1);
  });
});

describe("pasada incompleta — el cursor NO se mueve", () => {
  it("se detiene por presupuesto de tiempo sin comprometer el cursor", async () => {
    const { store, commits, runs } = createFakeStore();
    const t = reloj();
    const provider = createFakeFeedProvider(enCobertura(20), { pageSize: 2 });
    const original = provider.fetchModifiedSince.bind(provider);
    provider.fetchModifiedSince = async (s, c) => { t.avanzar(30_000); return original(s, c); };

    const r = await runMlsSync({ provider, store, now: t.now, timeBudgetMs: 50_000, maxPages: 100 });
    expect(r.completed).toBe(false);
    expect(r.stoppedBy).toBe("time_budget");
    expect(commits).toHaveLength(0);          // ← lo que importa
    expect(runs).toEqual([{ status: "partial", error: null }]);
    expect(r.upserted).toBeGreaterThan(0);    // lo ingerido se conserva
  });

  it("se detiene por tope de páginas sin comprometer el cursor", async () => {
    const { store, commits } = createFakeStore();
    const r = await runMlsSync({
      provider: createFakeFeedProvider(enCobertura(20), { pageSize: 2 }),
      store, now: () => 1_000_000, timeBudgetMs: 60_000, maxPages: 3,
    });
    expect(r.stoppedBy).toBe("max_pages");
    expect(r.pages).toBe(3);
    expect(commits).toHaveLength(0);
  });

  it("un fallo del proveedor no mueve el cursor y se registra", async () => {
    const { store, commits, runs } = createFakeStore();
    const r = await runMlsSync({
      provider: createFakeFeedProvider(enCobertura(10), { pageSize: 2, failOnCall: 2 }),
      store, now: () => 1_000_000, timeBudgetMs: 60_000, maxPages: 100,
    });
    expect(r.completed).toBe(false);
    expect(r.stoppedBy).toBe("error");
    expect(r.error).toContain("fallo inyectado");
    expect(commits).toHaveLength(0);
    expect(runs[0].status).toBe("failed");
  });

  it("reanudar tras un corte no duplica: el upsert va por listing_key", async () => {
    const { store, filas } = createFakeStore();
    const datos = enCobertura(6);
    await runMlsSync({ provider: createFakeFeedProvider(datos, { pageSize: 2 }), store,
                       now: () => 1_000_000, timeBudgetMs: 60_000, maxPages: 2 });
    const trasCorte = filas.size;
    await runMlsSync({ provider: createFakeFeedProvider(datos, { pageSize: 2 }), store,
                       now: () => 2_000_000, timeBudgetMs: 60_000, maxPages: 100 });
    expect(trasCorte).toBe(4);
    expect(filas.size).toBe(6);  // 6 únicas, no 10
  });
});

describe("filtro de cobertura dentro del worker", () => {
  it("descarta lo que está fuera de los tres condados y lo cuenta por motivo", async () => {
    const { store, filas } = createFakeStore();
    const r = await runMlsSync({
      provider: createFakeFeedProvider([
        makeResoListing({ ListingKey: "a", CountyOrParish: "Broward", StateOrProvince: "FL" } as never),
        makeResoListing({ ListingKey: "b", CountyOrParish: "Collier", StateOrProvince: "FL" } as never),
        makeResoListing({ ListingKey: "c", CountyOrParish: "Broward", StateOrProvince: "NY" } as never),
        makeResoListing({ ListingKey: "d", StateOrProvince: "FL" }),
      ], { pageSize: 10 }),
      store, now: () => 1_000_000, timeBudgetMs: 60_000, maxPages: 100,
    });
    expect(r.received).toBe(4);
    expect(r.upserted).toBe(1);
    expect(filas.has("a")).toBe(true);
    expect(r.excluded).toEqual({
      county_not_supported: 1, state_not_supported: 1, county_field_missing: 1,
      property_type_missing: 0, property_type_not_supported: 0,
    });
  });
});

describe("robustez ante fichas malformadas", () => {
  it("salta la ficha y sigue; no tumba la página", async () => {
    const { store, filas } = createFakeStore();
    const r = await runMlsSync({
      provider: createFakeFeedProvider([
        makeResoListing({ ListingKey: "ok", CountyOrParish: "Broward" } as never),
        // Debe pasar el filtro de cobertura para LLEGAR a la normalización: el orden es
        // cobertura → normalizar, así que una ficha que falla ambos se cuenta como
        // excluida, no como malformada.
        { ListingKey: "roto", ListingId: "", StandardStatus: "Active",
          CountyOrParish: "Broward", StateOrProvince: "FL", PropertyType: "Residential" } as never,
      ], { pageSize: 10 }),
      store, now: () => 1_000_000, timeBudgetMs: 60_000, maxPages: 100,
    });
    expect(r.malformed).toBe(1);
    expect(r.upserted).toBe(1);
    expect(filas.has("ok")).toBe(true);
    expect(r.completed).toBe(true);
  });
});

describe("syncNeedsAttention", () => {
  const base = { dataset: "d", resumed: false, completed: true, phase: "listings" as const,
                 pages: 1, received: 100, upserted: 100, removalKeysReceived: 0, removed: 0,
                 excluded: { county_field_missing: 0, state_not_supported: 0, county_not_supported: 0,
                             property_type_missing: 0, property_type_not_supported: 0 },
                 malformed: 0, stoppedBy: "completed" as const, error: null };

  it("una pasada sana no pide atención", () => {
    expect(syncNeedsAttention(base).attention).toBe(false);
  });

  it("alerta si la mayoría no trae condado determinable", () => {
    // Es la señal de que el nombre del campo no es el que asumimos.
    const r = syncNeedsAttention({ ...base, excluded: { ...base.excluded, county_field_missing: 60 } });
    expect(r.attention).toBe(true);
    expect(r.reason).toContain("mls:inspect-fields");
  });

  it("usa proporción, no conteo: 3 de 5.000 no es un problema", () => {
    expect(syncNeedsAttention({ ...base, received: 5000,
      excluded: { ...base.excluded, county_field_missing: 3 } }).attention).toBe(false);
  });

  it("alerta ante error y ante malformadas sistemáticas", () => {
    expect(syncNeedsAttention({ ...base, error: "boom" }).attention).toBe(true);
    expect(syncNeedsAttention({ ...base, malformed: 20 }).attention).toBe(true);
  });
});

describe("reanudación entre invocaciones", () => {
  // Sin esto el worker NO CONVERGE contra el feed real: 1,4 M de fichas son ~720 páginas
  // y en un presupuesto de 50 s caben ~56. Reempezar cada vez sería re-descargar
  // eternamente las mismas primeras páginas.
  it("una pasada parcial guarda dónde quedó", async () => {
    const { store, resumes, commits } = createFakeStore();
    await runMlsSync({
      provider: createFakeFeedProvider(enCobertura(20), { pageSize: 2 }),
      store, now: () => 1_000_000, timeBudgetMs: 60_000, maxPages: 3,
    });
    expect(commits).toHaveLength(0);           // el cursor de tiempo NO avanza
    expect(resumes).toHaveLength(1);
    expect(resumes[0].resumeCursor).not.toBeNull(); // pero sí se recuerda la posición
  });

  it("la invocación siguiente CONTINÚA en vez de reempezar", async () => {
    const datos = enCobertura(20);
    const { store, filas, estadoActual } = createFakeStore();

    const p1 = createFakeFeedProvider(datos, { pageSize: 2 });
    await runMlsSync({ provider: p1, store, now: () => 1_000_000, timeBudgetMs: 60_000, maxPages: 3 });
    const trasPrimera = filas.size;
    expect(estadoActual()?.resumeCursor).not.toBeNull();

    const p2 = createFakeFeedProvider(datos, { pageSize: 2 });
    const r2 = await runMlsSync({ provider: p2, store, now: () => 2_000_000, timeBudgetMs: 60_000, maxPages: 3 });

    expect(r2.resumed).toBe(true);
    // Si hubiera reempezado, las primeras 6 fichas se re-pedirían y filas.size seguiría
    // en 6. Continuar significa que avanza.
    expect(filas.size).toBeGreaterThan(trasPrimera);
  });

  it("al completar, el cursor de reanudación se limpia", async () => {
    const { store, estadoActual } = createFakeStore();
    await runMlsSync({
      provider: createFakeFeedProvider(enCobertura(4), { pageSize: 2 }),
      store, now: () => 1_000_000, timeBudgetMs: 60_000, maxPages: 100,
    });
    expect(estadoActual()?.resumeCursor).toBeNull();
  });

  it("un fallo a mitad también guarda la posición", async () => {
    const { store, resumes } = createFakeStore();
    const r = await runMlsSync({
      provider: createFakeFeedProvider(enCobertura(20), { pageSize: 2, failOnCall: 3 }),
      store, now: () => 1_000_000, timeBudgetMs: 60_000, maxPages: 100,
    });
    expect(r.stoppedBy).toBe("error");
    expect(resumes).toHaveLength(1);
  });
});

// ── A · Fichas vencidas ─────────────────────────────────────────────────────────────
// La ingesta filtra estado y tipo en la consulta, así que una ficha que deja de ser
// mostrable DEJA DE LLEGAR por ahí. Sin la fase de bajas quedaría "Active" para siempre.
describe("bajas del incremental", () => {
  const ficha = (key: string, over: Record<string, unknown> = {}) =>
    makeResoListing({
      ListingKey: key, CountyOrParish: "Miami-Dade", StateOrProvince: "FL",
      ModificationTimestamp: "2026-09-20T10:00:00Z", ...over,
    } as never);

  /** Carga inicial + deja el cursor en T0, lista para incrementales. */
  async function cargado(feed: ReturnType<typeof ficha>[]) {
    const f = createFakeStore();
    await runMlsSync({
      provider: createFakeFeedProvider(feed, { pageSize: 10 }),
      store: f.store, now: () => Date.UTC(2026, 8, 21), timeBudgetMs: 60_000, maxPages: 100,
    });
    return f;
  }
  const incremental = (feed: ReturnType<typeof ficha>[], store: SyncStore, over = {}) =>
    runMlsSync({
      provider: createFakeFeedProvider(feed, { pageSize: 10 }),
      store, now: () => Date.UTC(2026, 8, 22), timeBudgetMs: 60_000, maxPages: 100, ...over,
    });

  it("una ficha que pasa a Closed se BORRA en la siguiente pasada", async () => {
    const feed = [ficha("vive"), ficha("vende")];
    const { store, filas } = await cargado(feed);
    expect([...filas.keys()].sort()).toEqual(["vende", "vive"]);

    // En el feed real pasa a Closed y deja de llegar por la consulta de ingesta.
    feed[1] = ficha("vende", { StandardStatus: "Closed", ModificationTimestamp: "2026-09-21T15:00:00Z" });
    const r = await incremental(feed, store);

    expect(r.completed).toBe(true);
    expect(r.removalKeysReceived).toBe(1);
    expect(r.removed).toBe(1);
    expect(filas.has("vende")).toBe(false);
    expect(filas.has("vive")).toBe(true);
  });

  it("también Expired, Withdrawn y Canceled", async () => {
    const feed = ["Expired", "Withdrawn", "Canceled"].map((_, i) => ficha(`k${i}`));
    const { store, filas } = await cargado(feed);
    ["Expired", "Withdrawn", "Canceled"].forEach((st, i) => {
      feed[i] = ficha(`k${i}`, { StandardStatus: st, ModificationTimestamp: "2026-09-21T15:00:00Z" });
    });
    const r = await incremental(feed, store);
    expect(r.removed).toBe(3);
    expect(filas.size).toBe(0);
  });

  it("un cambio de tipo a uno no ingerible (p. ej. alquiler) también se borra", async () => {
    const feed = [ficha("tipo")];
    const { store, filas } = await cargado(feed);
    feed[0] = ficha("tipo", { PropertyType: "Residential Lease", ModificationTimestamp: "2026-09-21T15:00:00Z" });
    expect((await incremental(feed, store)).removed).toBe(1);
    expect(filas.has("tipo")).toBe(false);
  });

  it("una ficha que sigue mostrable pero sale de cobertura se borra en la fase de fichas", async () => {
    const feed = [ficha("condado")];
    const { store, filas } = await cargado(feed);
    feed[0] = ficha("condado", { CountyOrParish: "Collier", ModificationTimestamp: "2026-09-21T15:00:00Z" });
    const r = await incremental(feed, store);
    expect(r.removalKeysReceived).toBe(0); // la consulta de bajas no la ve…
    expect(r.removed).toBe(1);             // …pero la fase de fichas sí
    expect(filas.has("condado")).toBe(false);
  });

  it("NUNCA guarda el payload de una ficha no mostrable", async () => {
    const feed = [ficha("nueva-cerrada", { StandardStatus: "Closed", ModificationTimestamp: "2026-09-21T15:00:00Z" })];
    const { store, filas } = await cargado([]);
    const r = await incremental(feed, store);
    expect(r.removalKeysReceived).toBe(1);
    expect(r.removed).toBe(0);   // no estaba: borrar es un no-op
    expect(r.upserted).toBe(0);
    expect(filas.size).toBe(0);
  });

  it("la carga inicial (since null) NO ejecuta la consulta de bajas", async () => {
    // Sin `since` serían los 1,3 M de Closed del feed.
    const provider = createFakeFeedProvider([ficha("a"), ficha("b", { StandardStatus: "Closed" })], { pageSize: 10 });
    const bajas = vi.spyOn(provider, "fetchRemovedKeysSince");
    const { store } = createFakeStore();
    const r = await runMlsSync({ provider, store, now: () => 1_000_000, timeBudgetMs: 60_000, maxPages: 100 });
    expect(r.completed).toBe(true);
    expect(bajas).not.toHaveBeenCalled();
  });

  it("el cursor de tiempo NO avanza hasta terminar también la fase de bajas", async () => {
    const feed = [ficha("a"), ficha("b"), ficha("c")];
    const { store, commits, estadoActual } = await cargado(feed);
    const commitsAntes = commits.length;
    feed.forEach((_, i) => {
      feed[i] = ficha(["a", "b", "c"][i], { StandardStatus: "Closed", ModificationTimestamp: "2026-09-21T15:00:00Z" });
    });
    // pageSize 1: fichas (1 página vacía) + bajas (3 páginas). Tope de 2 páginas.
    const p = createFakeFeedProvider(feed, { pageSize: 1 });
    const r1 = await runMlsSync({ provider: p, store, now: () => Date.UTC(2026, 8, 22), timeBudgetMs: 60_000, maxPages: 2 });
    expect(r1.completed).toBe(false);
    expect(r1.phase).toBe("removals");
    expect(commits.length).toBe(commitsAntes);
    expect(estadoActual()?.passPhase).toBe("removals");
    expect(estadoActual()?.removalCursor).not.toBeNull();

    const r2 = await runMlsSync({ provider: createFakeFeedProvider(feed, { pageSize: 1 }), store,
      now: () => Date.UTC(2026, 8, 22, 1), timeBudgetMs: 60_000, maxPages: 100 });
    expect(r2.resumed).toBe(true);
    expect(r2.completed).toBe(true);
    expect(commits.length).toBe(commitsAntes + 1);
  });
});

describe("el cursor avanza al inicio de la PASADA, no de la última invocación", () => {
  it("una pasada que cruza invocaciones comete el sello de la primera", async () => {
    // Antes avanzaba al inicio de la invocación que terminaba: todo lo modificado entre
    // la primera y la última invocación se saltaba para siempre.
    const { store, commits } = createFakeStore();
    const datos = enCobertura(6);
    const t1 = Date.UTC(2026, 8, 22, 0, 0);
    const t2 = Date.UTC(2026, 8, 22, 6, 0);
    await runMlsSync({ provider: createFakeFeedProvider(datos, { pageSize: 2 }), store,
      now: () => t1, timeBudgetMs: 60_000, maxPages: 1 });
    await runMlsSync({ provider: createFakeFeedProvider(datos, { pageSize: 2 }), store,
      now: () => t2, timeBudgetMs: 60_000, maxPages: 100 });
    expect(commits).toHaveLength(1);
    expect(commits[0].ts).toBe(new Date(t1).toISOString());
  });
});
