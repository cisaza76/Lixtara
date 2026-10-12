import { describe, it, expect, vi } from "vitest";
import {
  runMlsReconciliation, reconcileNeedsAttention, reconcileDue, selectStaleKeys, FRESHNESS_RECENT_MS,
  REFETCH_MAX_PER_RUN,
  type ReconcileStore, type ReconcileState, type ReconcileFinish,
} from "./reconcile-run";
import { createFakeFeedProvider, makeResoListing } from "./feed-port.fake";
import type { NormalizedListing, ResoListing } from "./feed-port";

// Base falsa con las dos marcas de tiempo de las que depende el barrido. El predicado de
// `sweepUnconfirmed` replica EXACTAMENTE el de `mls_reconcile_sweep` en la migración
// 20260926120000 (hay un test que ancla el SQL, abajo).
interface Fila { lastSeenAt: string; lastConfirmedAt: string | null }

function createFakeDb(claves: string[], lastSeenAt = "2026-09-20T00:00:00.000Z") {
  const filas = new Map<string, Fila>(claves.map((k) => [k, { lastSeenAt, lastConfirmedAt: null }]));
  let estado: ReconcileState | null = null;
  const finales: ReconcileFinish[] = [];
  const runs: Array<{ status: string; error: string | null }> = [];
  const store: ReconcileStore = {
    async readReconcileState() { return estado; },
    async beginReconciliation(dataset, startedAt) {
      estado = { dataset, startedAt, cursor: null, keysSeen: 0, lastFinishedAt: estado?.lastFinishedAt ?? null };
    },
    async confirmListings(keys, at) {
      let n = 0;
      for (const k of keys) { const f = filas.get(k); if (f) { f.lastConfirmedAt = at; n += 1; } }
      return n;
    },
    async saveReconcileProgress(_d, cursor, keysSeen) { estado = { ...estado!, cursor, keysSeen }; },
    async countListings() { return filas.size; },
    async sweepUnconfirmed(startedAt) {
      let n = 0;
      for (const [k, f] of filas) {
        if ((f.lastConfirmedAt === null || f.lastConfirmedAt < startedAt) && f.lastSeenAt < startedAt) {
          filas.delete(k); n += 1;
        }
      }
      return n;
    },
    async finishReconciliation(dataset, r) {
      finales.push(r);
      estado = { dataset, startedAt: null, cursor: null, keysSeen: 0, lastFinishedAt: new Date(reloj.t).toISOString() };
    },
    async recordReconcileRun(_d, status, error) { runs.push({ status, error }); },
  };
  return { store, filas, finales, runs, estadoActual: () => estado };
}

const reloj = { t: Date.UTC(2026, 8, 26, 8, 7) };
const ficha = (key: string, over: Record<string, unknown> = {}): ResoListing =>
  makeResoListing({ ListingKey: key, CountyOrParish: "Broward", StateOrProvince: "FL", ...over } as never);
const claves = (n: number, prefijo = "k") => Array.from({ length: n }, (_, i) => `${prefijo}${i}`);

const correr = (feed: ResoListing[], store: ReconcileStore, over: Record<string, unknown> = {}) =>
  runMlsReconciliation({
    provider: createFakeFeedProvider(feed, { pageSize: 5 }),
    store, now: () => reloj.t, timeBudgetMs: 60_000, maxPages: 100, ...over,
  });

describe("reconciliación — fichas eliminadas del feed", () => {
  it("borra lo guardado que ya no está en la lista mostrable", async () => {
    const guardadas = claves(10);
    const db = createFakeDb(guardadas);
    // El feed conserva 9 de 10: k9 fue ELIMINADA (no cambió de estado: desapareció).
    const r = await correr(guardadas.slice(0, 9).map((k) => ficha(k)), db.store);

    expect(r.outcome).toBe("ok");
    expect(r.keysSeen).toBe(9);
    expect(r.stored).toBe(10);
    expect(r.deleted).toBe(1);
    expect(db.filas.has("k9")).toBe(false);
    expect(db.filas.size).toBe(9);
    expect(db.finales).toEqual([{ status: "ok", deleted: 1, keysSeen: 9, stored: 10, error: null, freshness: null }]);
  });

  it("una clave de la lista que cae fuera de cobertura NO confirma su fila", async () => {
    const db = createFakeDb(claves(10));
    const feed = claves(10).map((k) => ficha(k));
    feed[0] = ficha("k0", { CountyOrParish: "Collier" });
    const r = await correr(feed, db.store);
    expect(r.keysSeen).toBe(9);
    expect(r.deleted).toBe(1);
    expect(db.filas.has("k0")).toBe(false);
  });

  it("claves que no teníamos no cuentan como borradas ni fallan", async () => {
    const db = createFakeDb(claves(5));
    const r = await correr([...claves(5), "nueva"].map((k) => ficha(k)), db.store);
    expect(r.outcome).toBe("ok");
    expect(r.deleted).toBe(0);
    expect(db.filas.size).toBe(5);
  });
});

describe("protección del 80 %", () => {
  it("si la lista trae menos del 80 % de lo guardado, ABORTA sin borrar nada", async () => {
    const db = createFakeDb(claves(100));
    // Feed incompleto: solo 79 de 100.
    const r = await correr(claves(79).map((k) => ficha(k)), db.store);
    expect(r.outcome).toBe("aborted");
    expect(r.deleted).toBe(0);
    expect(db.filas.size).toBe(100);           // ← lo que importa
    expect(db.finales[0]).toMatchObject({ status: "aborted", deleted: 0, keysSeen: 79, stored: 100 });
    expect(db.finales[0].error).toContain("80 %");
    expect(reconcileNeedsAttention(r).attention).toBe(true);
  });

  it("con exactamente el 80 % sí barre", async () => {
    const db = createFakeDb(claves(100));
    const r = await correr(claves(80).map((k) => ficha(k)), db.store);
    expect(r.outcome).toBe("ok");
    expect(r.deleted).toBe(20);
  });

  it("una lista VACÍA con la tabla llena aborta — el caso de un feed caído", async () => {
    const db = createFakeDb(claves(50));
    const r = await correr([], db.store);
    expect(r.outcome).toBe("aborted");
    expect(db.filas.size).toBe(50);
  });

  it("con la tabla vacía no hay nada que proteger", async () => {
    const db = createFakeDb([]);
    expect((await correr([], db.store)).outcome).toBe("ok");
  });

  it("cuenta solo claves EN COBERTURA: 100 claves fuera de los condados no pasan la protección", async () => {
    const db = createFakeDb(claves(100));
    const r = await correr(claves(100).map((k) => ficha(k, { CountyOrParish: "Collier" })), db.store);
    expect(r.outcome).toBe("aborted");
    expect(db.filas.size).toBe(100);
  });
});

describe("no borra lo que el incremental tocó durante la reconciliación", () => {
  it("una ficha sincronizada después de startedAt sobrevive aunque no esté en la lista", async () => {
    const db = createFakeDb(claves(10));
    // Invocación 1: empieza y se corta tras una página (5 claves).
    const feed = claves(9).map((k) => ficha(k)); // k9 no está en la lista
    const r1 = await correr(feed, db.store, { maxPages: 1 });
    expect(r1.outcome).toBe("partial");
    const startedAt = db.estadoActual()!.startedAt!;

    // Entre invocaciones, el incremental inserta "nueva" y refresca k9: last_seen_at
    // posterior al inicio de la reconciliación.
    const después = new Date(Date.parse(startedAt) + 60_000).toISOString();
    db.filas.set("nueva", { lastSeenAt: después, lastConfirmedAt: null });
    db.filas.get("k9")!.lastSeenAt = después;

    const r2 = await correr(feed, db.store);
    expect(r2.outcome).toBe("ok");
    expect(db.filas.has("nueva")).toBe(true);
    expect(db.filas.has("k9")).toBe(true);
    expect(r2.deleted).toBe(0);
  });
});

describe("programación y reanudación", () => {
  it("no toca dos veces el mismo día UTC: no llama a Bridge", async () => {
    const db = createFakeDb(claves(3));
    await correr(claves(3).map((k) => ficha(k)), db.store);
    const provider = createFakeFeedProvider([], { pageSize: 5 });
    const r = await runMlsReconciliation({ provider, store: db.store,
      now: () => reloj.t + 60 * 60 * 1000, timeBudgetMs: 60_000, maxPages: 100 });
    expect(r.outcome).toBe("not_due");
    expect(provider.callCount()).toBe(0);
  });

  it("toca de nuevo al día siguiente", async () => {
    const db = createFakeDb(claves(3));
    await correr(claves(3).map((k) => ficha(k)), db.store);
    const r = await runMlsReconciliation({ provider: createFakeFeedProvider(claves(3).map((k) => ficha(k))),
      store: db.store, now: () => reloj.t + 24 * 60 * 60 * 1000, timeBudgetMs: 60_000, maxPages: 100 });
    expect(r.outcome).toBe("ok");
  });

  it("continúa entre invocaciones sin contar dos veces", async () => {
    const db = createFakeDb(claves(12));
    const feed = claves(12).map((k) => ficha(k));
    const r1 = await correr(feed, db.store, { maxPages: 1 });
    expect(r1.outcome).toBe("partial");
    expect(db.estadoActual()?.keysSeen).toBe(5);
    const r2 = await correr(feed, db.store, { maxPages: 1 });
    expect(r2.started).toBe(false);
    expect(db.estadoActual()?.keysSeen).toBe(10);
    const r3 = await correr(feed, db.store);
    expect(r3.outcome).toBe("ok");
    expect(r3.keysSeen).toBe(12);
    expect(r3.deleted).toBe(0);
  });

  it("un fallo del proveedor registra `failed`, conserva el progreso y no borra", async () => {
    const db = createFakeDb(claves(12));
    const r = await runMlsReconciliation({
      provider: createFakeFeedProvider(claves(12).map((k) => ficha(k)), { pageSize: 5, failOnCall: 2 }),
      store: db.store, now: () => reloj.t, timeBudgetMs: 60_000, maxPages: 100,
    });
    expect(r.outcome).toBe("failed");
    expect(db.runs).toEqual([{ status: "failed", error: "fallo inyectado del proveedor" }]);
    expect(db.estadoActual()?.cursor).not.toBeNull();
    expect(db.filas.size).toBe(12);
  });

  it("una reconciliación a medias de más de 20 h se reempieza desde cero", async () => {
    const db = createFakeDb(claves(12));
    const feed = claves(12).map((k) => ficha(k));
    await correr(feed, db.store, { maxPages: 1 });
    const r = await runMlsReconciliation({ provider: createFakeFeedProvider(feed, { pageSize: 5 }),
      store: db.store, now: () => reloj.t + 21 * 60 * 60 * 1000, timeBudgetMs: 60_000, maxPages: 100 });
    expect(r.restartedStale).toBe(true);
    expect(r.started).toBe(true);
    expect(r.keysSeen).toBe(12);
    expect(r.outcome).toBe("ok");
    expect(r.deleted).toBe(0);
  });
});

describe("calendario: una vez por día UTC (2026-10-11)", () => {
  const H = 60 * 60 * 1000;
  const at = (iso: string) => Date.parse(iso);

  it("el caso real: corrida manual a las 21:15 UTC → la mañana siguiente SÍ toca", () => {
    expect(reconcileDue(at("2026-10-10T21:15:35Z"), at("2026-10-11T08:07:00Z"))).toBe(true);
  });

  it("después de completar en la mañana, ese mismo día ya no toca", () => {
    expect(reconcileDue(at("2026-10-11T08:09:00Z"), at("2026-10-11T08:22:00Z"))).toBe(false);
    expect(reconcileDue(at("2026-10-11T08:09:00Z"), at("2026-10-11T23:59:00Z"))).toBe(false);
  });

  it("sin reconciliaciones previas, toca", () => {
    expect(reconcileDue(null, at("2026-10-11T08:07:00Z"))).toBe(true);
  });

  it("dentro de la ventana del cron el hueco máximo entre dos es ~27 h", () => {
    // Peor caso: termina 08:07 un día y la siguiente cierra en el último intento, 10:52.
    const a = at("2026-10-11T08:07:00Z");
    const b = at("2026-10-12T10:52:00Z");
    expect(reconcileDue(a, b)).toBe(true);
    expect((b - a) / H).toBeLessThan(28);
  });

  it("integrado: tras una manual de la noche, la de la mañana corre y cierra", async () => {
    const db = createFakeDb(claves(3));
    const feed = claves(3).map((k) => ficha(k));
    const original = reloj.t;
    try {
      // La base falsa sella `lastFinishedAt` con `reloj.t`: la manual termina a las 21:15.
      reloj.t = at("2026-10-10T21:15:00Z");
      const manual = await runMlsReconciliation({ provider: createFakeFeedProvider(feed, { pageSize: 5 }),
        store: db.store, now: () => reloj.t, timeBudgetMs: 60_000, maxPages: 100 });
      expect(manual.outcome).toBe("ok");
      expect(db.estadoActual()?.lastFinishedAt).toBe("2026-10-10T21:15:00.000Z");
      // Con la regla vieja (20 h) esto era not_due; ahora corre.
      reloj.t = at("2026-10-11T08:07:00Z");
      const mañana = await runMlsReconciliation({ provider: createFakeFeedProvider(feed, { pageSize: 5 }),
        store: db.store, now: () => reloj.t, timeBudgetMs: 60_000, maxPages: 100 });
      expect(mañana.outcome).toBe("ok");
      // Y un segundo intento en la misma ventana ya no toca.
      reloj.t = at("2026-10-11T08:22:00Z");
      const otra = await runMlsReconciliation({ provider: createFakeFeedProvider(feed, { pageSize: 5 }),
        store: db.store, now: () => reloj.t, timeBudgetMs: 60_000, maxPages: 100 });
      expect(otra.outcome).toBe("not_due");
    } finally {
      reloj.t = original;
    }
  });
});

describe("reconcileNeedsAttention", () => {
  const base = { dataset: "d", started: true, restartedStale: false, pages: 1, keysReceived: 10,
    keysSeen: 10, stoppedBy: "completed" as const, error: null, freshness: null, refetched: 0 };
  it("sana no pide atención; aborto, fallo y borrado >10 % sí", () => {
    expect(reconcileNeedsAttention({ ...base, outcome: "ok", stored: 100, deleted: 2 }).attention).toBe(false);
    expect(reconcileNeedsAttention({ ...base, outcome: "ok", stored: 100, deleted: 11 }).attention).toBe(true);
    expect(reconcileNeedsAttention({ ...base, outcome: "aborted", stored: 100, deleted: 0 }).attention).toBe(true);
    expect(reconcileNeedsAttention({ ...base, outcome: "failed", stored: null, deleted: 0 }).attention).toBe(true);
  });
});

describe("diagnóstico de frescura (Opción B, solo mide)", () => {
  /** Base falsa con fechas de Bridge guardadas por clave, y la misma regla que el SQL. */
  function conFrescura(guardadas: Record<string, string | null>, opts: { fallaEnLlamada?: number } = {}) {
    const db = createFakeDb(Object.keys(guardadas));
    let llamadas = 0;
    const store: ReconcileStore = {
      ...db.store,
      async saveReconcileProgress(dataset, cursor, keysSeen, freshness) {
        await db.store.saveReconcileProgress(dataset, cursor, keysSeen);
        const e = db.estadoActual();
        if (e) (e as ReconcileState).freshness = freshness ?? null;
      },
      async readReconcileState(dataset) {
        const e = await db.store.readReconcileState(dataset);
        return e;
      },
      async compareFreshness(records, recentAfter) {
        llamadas += 1;
        if (opts.fallaEnLlamada === llamadas) throw new Error("rpc caída");
        const f = { missing: 0, stale: 0, recent: 0, current: 0, unknown: 0 };
        for (const r of records) {
          if (!(r.key in guardadas)) { f.missing += 1; continue; }
          const g = guardadas[r.key];
          if (!g || !r.bridgeTs) { f.unknown += 1; continue; }
          if (g >= r.bridgeTs) f.current += 1;
          else if (r.bridgeTs < recentAfter) f.stale += 1;
          else f.recent += 1;
        }
        return f;
      },
    };
    return { ...db, store };
  }
  const T = (iso: string) => iso;

  it("cuenta faltantes, desactualizadas, recientes, al día y sin dato, sin tocar nada", async () => {
    const db = conFrescura({ a: T("2026-09-20T00:00:00Z"), b: T("2026-09-01T00:00:00Z"), c: T("2026-09-25T00:00:00Z"), d: null });
    const feed = [
      ficha("a", { BridgeModificationTimestamp: "2026-09-20T00:00:00Z" }),            // al día
      ficha("b", { BridgeModificationTimestamp: "2026-09-10T00:00:00Z" }),            // vieja
      ficha("c", { BridgeModificationTimestamp: new Date(reloj.t - 30 * 60_000).toISOString() }), // reciente (<2 h)
      ficha("d", { BridgeModificationTimestamp: "2026-09-10T00:00:00Z" }),            // sin dato guardado
      ficha("nueva", { BridgeModificationTimestamp: "2026-09-10T00:00:00Z" }),        // falta
    ];
    const r = await correr(feed, db.store);
    expect(r.outcome).toBe("ok");
    expect(r.freshness).toEqual({ missing: 1, stale: 1, recent: 1, current: 1, unknown: 1 });
    expect(db.finales[0].freshness).toEqual(r.freshness);
    // Solo mide: no borra nada que esté en la lista y no agrega la que falta.
    expect(r.deleted).toBe(0);
    expect(db.filas.has("nueva")).toBe(false);
    expect(FRESHNESS_RECENT_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("acumula entre invocaciones sin contar dos veces", async () => {
    const guardadas = Object.fromEntries(claves(12).map((k) => [k, "2026-09-20T00:00:00Z"]));
    const db = conFrescura(guardadas);
    const feed = claves(12).map((k) => ficha(k, { BridgeModificationTimestamp: "2026-09-20T00:00:00Z" }));
    await correr(feed, db.store, { maxPages: 1 });
    const r = await correr(feed, db.store);
    expect(r.outcome).toBe("ok");
    expect(r.freshness).toEqual({ missing: 0, stale: 0, recent: 0, current: 12, unknown: 0 });
  });

  it("si la función falla, la reconciliación sigue y el diagnóstico queda no disponible", async () => {
    const db = conFrescura(Object.fromEntries(claves(12).map((k) => [k, "2026-09-20T00:00:00Z"])), { fallaEnLlamada: 2 });
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await correr(claves(12).map((k) => ficha(k)), db.store);
    expect(r.outcome).toBe("ok");
    expect(r.deleted).toBe(0);
    expect(r.freshness).toBeNull();
    expect(errores.mock.calls.some((c) => String(c[0]).includes("mls_freshness_unavailable"))).toBe(true);
    errores.mockRestore();
  });

  it("un store sin diagnóstico (versión anterior) funciona igual", async () => {
    const db = createFakeDb(claves(3));
    const r = await correr(claves(3).map((k) => ficha(k)), db.store);
    expect(r.outcome).toBe("ok");
    expect(r.freshness).toBeNull();
  });
});



describe("recuperación de fichas desactualizadas (arreglo 2026-10-12)", () => {
  const VIEJA = "2026-09-01T00:00:00Z";
  const NUEVA = "2026-09-10T00:00:00Z";

  /** Base falsa con la fecha de Bridge guardada por clave + upsert que la actualiza. */
  function conRecuperacion(guardadas: Record<string, string | null>, opts: { upsertFalla?: boolean } = {}) {
    const db = createFakeDb(Object.keys(guardadas));
    const fechas = new Map<string, string | null>(Object.entries(guardadas));
    const upserts: NormalizedListing[][] = [];
    const store: ReconcileStore = {
      ...db.store,
      async saveReconcileProgress(dataset, cursor, keysSeen, freshness) {
        await db.store.saveReconcileProgress(dataset, cursor, keysSeen);
        const e = db.estadoActual();
        if (e) (e as ReconcileState).freshness = freshness ?? null;
      },
      async compareFreshness(records, recentAfter) {
        const f = { missing: 0, stale: 0, recent: 0, current: 0, unknown: 0 };
        for (const r of records) {
          if (!fechas.has(r.key)) { f.missing += 1; continue; }
          const g = fechas.get(r.key);
          if (!g || !r.bridgeTs) { f.unknown += 1; continue; }
          if (g >= r.bridgeTs) f.current += 1;
          else if (r.bridgeTs < recentAfter) f.stale += 1;
          else f.recent += 1;
        }
        return f;
      },
      async storedBridgeTimestamps(keys) {
        return new Map(keys.filter((k) => fechas.has(k)).map((k) => [k, fechas.get(k) ?? null]));
      },
      async upsertListings(rows) {
        if (opts.upsertFalla) throw new Error("upsert caído");
        upserts.push(rows);
        for (const r of rows) {
          fechas.set(r.listing_key, String((r.payload as ResoListing).BridgeModificationTimestamp ?? null));
        }
        return rows.length;
      },
    };
    return { ...db, store, upserts, fechas };
  }

  it("vuelve a descargar SOLO las desactualizadas y las guarda; las demás no se tocan", async () => {
    const db = conRecuperacion({ a: NUEVA, b: VIEJA, c: VIEJA, d: null });
    const feed = [
      ficha("a", { BridgeModificationTimestamp: NUEVA }),                                       // al día
      ficha("b", { BridgeModificationTimestamp: NUEVA, ListPrice: 450_000 }),                   // vieja → se recupera
      ficha("c", { BridgeModificationTimestamp: new Date(reloj.t - 30 * 60_000).toISOString() }), // reciente: la toma el sync
      ficha("d", { BridgeModificationTimestamp: NUEVA }),                                       // sin fecha guardada
      ficha("nueva", { BridgeModificationTimestamp: NUEVA }),                                   // no guardada
    ];
    const r = await correr(feed, db.store);
    expect(r.outcome).toBe("ok");
    expect(r.refetched).toBe(1);
    expect(db.upserts.flat().map((x) => x.listing_key)).toEqual(["b"]);
    expect(db.upserts[0][0].list_price).toBe(450_000);
    // El diagnóstico sigue contando lo que ENCONTRÓ, y registra lo que corrigió.
    expect(r.freshness).toMatchObject({ stale: 1, refetched: 1 });
    expect(db.finales[0].freshness).toMatchObject({ stale: 1, refetched: 1 });
    // Una segunda reconciliación (otro día) ya no encuentra "b" desactualizada. ("c", que
    // ayer era reciente, hoy ya tiene más de 2 h sin que el sync la tomara: esa sí se
    // recupera ahora.)
    reloj.t += 24 * 60 * 60 * 1000;
    const r2 = await correr(feed, db.store);
    expect(db.upserts.slice(1).flat().map((x) => x.listing_key)).toEqual(["c"]);
    expect(r2.freshness).toMatchObject({ stale: 1, refetched: 1 });
    reloj.t -= 24 * 60 * 60 * 1000;
  });

  it("una desactualizada que ya no es ingerible o salió de cobertura no se guarda", async () => {
    const db = conRecuperacion({ b: VIEJA, e: VIEJA });
    const feed = [
      ficha("b", { BridgeModificationTimestamp: NUEVA, CountyOrParish: "Orange" }), // fuera de cobertura
      ficha("e", { BridgeModificationTimestamp: NUEVA }),
    ];
    const r = await correr(feed, db.store);
    expect(db.upserts.flat().map((x) => x.listing_key)).toEqual(["e"]);
    expect(r.refetched).toBe(1);
  });

  it("si la recuperación falla, la reconciliación termina igual (y borra lo eliminado)", async () => {
    const presentes = claves(8, "p");
    const db = conRecuperacion(
      { b: VIEJA, z: VIEJA, ...Object.fromEntries(presentes.map((k) => [k, NUEVA])) }, { upsertFalla: true });
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await correr([
      ficha("b", { BridgeModificationTimestamp: NUEVA }),
      ...presentes.map((k) => ficha(k, { BridgeModificationTimestamp: NUEVA })),
    ], db.store);
    expect(r.outcome).toBe("ok");
    expect(r.deleted).toBe(1); // z ya no está en el feed
    expect(r.refetched).toBe(0);
    expect(errores.mock.calls.some((c) => String(c[0]).includes("mls_stale_refetch_failed"))).toBe(true);
    errores.mockRestore();
  });

  it("sin los métodos de recuperación (store viejo) no intenta nada", async () => {
    const db = conRecuperacion({ b: VIEJA });
    const sinRecuperar: ReconcileStore = { ...db.store };
    delete sinRecuperar.storedBridgeTimestamps;
    delete sinRecuperar.upsertListings;
    const r = await correr([ficha("b", { BridgeModificationTimestamp: NUEVA })], sinRecuperar);
    expect(r.refetched).toBe(0);
    expect(r.freshness?.refetched).toBeUndefined();
  });

  it("respeta el tope por invocación", async () => {
    const n = REFETCH_MAX_PER_RUN + 3;
    const ks = claves(n);
    const db = conRecuperacion(Object.fromEntries(ks.map((k) => [k, VIEJA])));
    const r = await correr(ks.map((k) => ficha(k, { BridgeModificationTimestamp: NUEVA })), db.store, {
      provider: createFakeFeedProvider(ks.map((k) => ficha(k, { BridgeModificationTimestamp: NUEVA })), { pageSize: 2000 }),
    });
    expect(r.refetched).toBe(REFETCH_MAX_PER_RUN);
  });

  it("selectStaleKeys: misma regla que el SQL", () => {
    const stored = new Map<string, string | null>([["a", VIEJA], ["b", NUEVA], ["c", null]]);
    const recentAfter = "2026-09-20T00:00:00Z";
    expect(selectStaleKeys([
      { key: "a", bridgeTs: NUEVA },               // vieja → sí
      { key: "b", bridgeTs: NUEVA },               // igual → no
      { key: "c", bridgeTs: NUEVA },               // sin fecha guardada → no
      { key: "x", bridgeTs: NUEVA },               // no guardada → no
      { key: "a", bridgeTs: null },                // sin fecha de Bridge → no
      { key: "a", bridgeTs: "2026-09-21T00:00:00Z" }, // reciente → no
    ], stored, recentAfter)).toEqual(["a"]);
  });
});
