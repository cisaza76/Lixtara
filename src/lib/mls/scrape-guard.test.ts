import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MLS_VIEWS_PER_5_MIN,
  MLS_VIEWS_PER_DAY,
  checkMlsView,
  clientIp,
  clientTag,
  memoryCheck,
  resetMemoryForTests,
  type GuardDeps,
} from "./scrape-guard";

/** Limitador de ventana deslizante en memoria, atómico por llamada (como Upstash). */
function fakeLimiter(max: number, windowMs: number, clock: { t: number }) {
  const hits = new Map<string, number[]>();
  return {
    limit: vi.fn(async (id: string) => {
      const list = (hits.get(id) ?? []).filter((t) => clock.t - t < windowMs);
      list.push(clock.t);
      hits.set(id, list);
      return { success: list.length <= max };
    }),
  };
}

const T0 = Date.parse("2026-10-11T12:00:00Z");
let clock: { t: number };
let deps: GuardDeps;
beforeEach(() => {
  resetMemoryForTests();
  clock = { t: T0 };
  deps = {
    short: fakeLimiter(MLS_VIEWS_PER_5_MIN, 5 * 60_000, clock),
    daily: fakeLimiter(MLS_VIEWS_PER_DAY, 24 * 3_600_000, clock),
    now: () => clock.t,
  };
});

describe("permitidas y bloqueadas", () => {
  it("una persona que navega normal no se bloquea", async () => {
    for (let i = 0; i < 40; i++) {
      clock.t += 5_000;
      expect((await checkMlsView("203.0.113.7", deps)).outcome).toBe("ok");
    }
  });

  it("ráfaga: bloquea pasado el tope de 5 minutos", async () => {
    for (let i = 0; i < MLS_VIEWS_PER_5_MIN; i++) await checkMlsView("203.0.113.7", deps);
    const r = await checkMlsView("203.0.113.7", deps);
    expect(r).toMatchObject({ outcome: "limited", window: "5m", degraded: false });
  });

  it("goteo dentro del límite corto: lo frena el tope diario (no se baja el feed en 3 h)", async () => {
    let limitedAt = -1;
    for (let i = 0; i < MLS_VIEWS_PER_DAY + 5; i++) {
      clock.t += 6_000; // 50 por 5 minutos, siempre por debajo del corto
      const r = await checkMlsView("203.0.113.7", deps);
      if (r.outcome === "limited") { limitedAt = i; expect(r).toMatchObject({ window: "24h" }); break; }
    }
    expect(limitedAt).toBe(MLS_VIEWS_PER_DAY);
  });

  it("solicitudes concurrentes se cuentan todas", async () => {
    const results = await Promise.all(
      Array.from({ length: MLS_VIEWS_PER_5_MIN + 10 }, () => checkMlsView("203.0.113.7", deps)),
    );
    expect(results.filter((r) => r.outcome === "limited")).toHaveLength(10);
  });

  it("otro cliente no se ve afectado", async () => {
    for (let i = 0; i <= MLS_VIEWS_PER_5_MIN; i++) await checkMlsView("203.0.113.7", deps);
    expect((await checkMlsView("198.51.100.9", deps)).outcome).toBe("ok");
  });
});

describe("falla del servicio de contadores", () => {
  it("si Upstash lanza un error: respaldo en memoria con los mismos topes, sin bloquear de más", async () => {
    const boom = { limit: vi.fn(async () => { throw new Error("ECONNRESET"); }) };
    const d: GuardDeps = { short: boom, daily: boom, now: () => clock.t };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < MLS_VIEWS_PER_5_MIN; i++) {
      expect(await checkMlsView("203.0.113.7", d)).toMatchObject({ outcome: "ok", degraded: true });
    }
    expect(await checkMlsView("203.0.113.7", d)).toMatchObject({ outcome: "limited", degraded: true, window: "5m" });
    // Un aviso por minuto, no uno por petición.
    expect(errors.mock.calls.filter((c) => String(c[0]).includes("mls_rate_limit_degraded")).length).toBe(1);
    errors.mockRestore();
  });

  it("sin Upstash configurado: mismo respaldo", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await checkMlsView("203.0.113.7", { short: null, daily: null, now: () => clock.t + 120_000 });
    expect(r).toMatchObject({ outcome: "ok", degraded: true });
    errors.mockRestore();
  });

  it("respuesta malformada del proveedor: respaldo", async () => {
    const weird = { limit: vi.fn(async () => ({}) as { success: boolean }) };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await checkMlsView("203.0.113.7", { short: weird, daily: weird, now: () => clock.t + 240_000 }))
      .toMatchObject({ degraded: true });
    errors.mockRestore();
  });

  it("el respaldo poda lo viejo: pasado un día, el cliente vuelve a empezar", () => {
    for (let i = 0; i < MLS_VIEWS_PER_DAY; i++) memoryCheck("tag", T0 + i * 10_000);
    expect(memoryCheck("tag", T0 + 25 * 3_600_000)).toBe("ok");
  });
});

describe("identidad sin IP", () => {
  it("la etiqueta no contiene la IP, depende de la clave y rota cada día", () => {
    const d1 = new Date("2026-10-11T10:00:00Z");
    const d2 = new Date("2026-10-12T10:00:00Z");
    const a = clientTag("203.0.113.7", d1, "secret-A");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toContain("203");
    expect(clientTag("203.0.113.7", d1, "secret-A")).toBe(a);
    expect(clientTag("203.0.113.7", d2, "secret-A")).not.toBe(a);
    expect(clientTag("203.0.113.7", d1, "secret-B")).not.toBe(a);
  });

  it("a Upstash le llega la etiqueta, nunca la IP", async () => {
    await checkMlsView("203.0.113.7", deps);
    const id = (deps.short!.limit as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(id).not.toContain("203.0.113.7");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("la IP sale del primer salto de x-forwarded-for (la que pone Vercel)", () => {
    const h: Record<string, string> = { "x-forwarded-for": "203.0.113.7, 10.0.0.1" };
    expect(clientIp((n) => h[n] ?? null)).toBe("203.0.113.7");
    expect(clientIp(() => null)).toBe("unknown");
  });
});
