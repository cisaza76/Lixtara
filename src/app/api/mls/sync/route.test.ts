import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// El store real toca Supabase y el proveedor real toca la red: ambos se simulan para que
// el test cubra las DOS puertas de la ruta, que es lo que importa aquí.
vi.mock("@/lib/mls/sync-store.supabase", () => ({ createSupabaseSyncStore: () => ({}) }));
vi.mock("@/lib/mls/bridge-adapter", () => ({ createBridgeProvider: () => ({ dataset: "mia" }) }));
vi.mock("@/lib/mls/sync-run", () => ({
  runMlsSync: vi.fn(async () => ({
    dataset: "mia", completed: true, pages: 1, received: 3, upserted: 3,
    excluded: { county_field_missing: 0, state_not_supported: 0, county_not_supported: 0 },
    malformed: 0, stoppedBy: "completed", error: null,
  })),
  syncNeedsAttention: () => ({ attention: false }),
}));

import { GET } from "./route";

const SECRET = "secreto-de-cron-para-pruebas";
const pedir = (auth?: string) =>
  new Request("https://lixtara.com/api/mls/sync", auth ? { headers: { authorization: auth } } : undefined);

const env = { ...process.env };
beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  process.env.VERCEL_ENV = "production";
  process.env.MLS_FEED_ENABLED = "true";
  process.env.MLS_BRIDGE_DATASET = "mia";
});
afterEach(() => { process.env = { ...env }; });

describe("puerta 1 · secreto del cron", () => {
  it("401 sin cabecera", async () => {
    expect((await GET(pedir())).status).toBe(401);
  });

  it("401 con secreto incorrecto de la MISMA longitud", async () => {
    // El caso que un compare ingenuo dejaría pasar por tiempo.
    const mismo = "X".repeat(SECRET.length);
    expect((await GET(pedir(`Bearer ${mismo}`))).status).toBe(401);
  });

  it("401 cuando CRON_SECRET no está configurado — fail-closed", async () => {
    // Nunca "abierto" por omisión.
    delete process.env.CRON_SECRET;
    expect((await GET(pedir(`Bearer ${SECRET}`))).status).toBe(401);
  });

  it("todos los fallos devuelven el MISMO cuerpo: no se revela el porqué", async () => {
    const sin = await (await GET(pedir())).json();
    const malo = await (await GET(pedir("Bearer otro"))).json();
    delete process.env.CRON_SECRET;
    const nocfg = await (await GET(pedir(`Bearer ${SECRET}`))).json();
    expect(sin).toEqual(malo);
    expect(malo).toEqual(nocfg);
  });

  it("acepta el secreto correcto, con y sin prefijo Bearer", async () => {
    expect((await GET(pedir(`Bearer ${SECRET}`))).status).toBe(200);
    expect((await GET(pedir(SECRET))).status).toBe(200);
  });
});

describe("puerta 2 · gate de entorno", () => {
  it("404 en preview, aunque el secreto sea correcto", async () => {
    // El acuerdo licencia el feed para UN sitio; un preview no es ese sitio.
    process.env.VERCEL_ENV = "preview";
    expect((await GET(pedir(`Bearer ${SECRET}`))).status).toBe(404);
  });

  it("404 sin el flag", async () => {
    delete process.env.MLS_FEED_ENABLED;
    expect((await GET(pedir(`Bearer ${SECRET}`))).status).toBe(404);
  });

  it("404 y no 403: fuera de producción la ruta no admite que existe", async () => {
    process.env.VERCEL_ENV = "development";
    const r = await GET(pedir(`Bearer ${SECRET}`));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not_found" });
  });

  it("el secreto se verifica ANTES del gate", async () => {
    // Un atacante sin el secreto no debe poder distinguir producción de preview.
    process.env.VERCEL_ENV = "preview";
    expect((await GET(pedir("Bearer malo"))).status).toBe(401);
  });
});

describe("respuesta", () => {
  it("devuelve el resumen sin trazas ni mensajes de error crudos", async () => {
    const r = await GET(pedir(`Bearer ${SECRET}`));
    const body = await r.json();
    expect(body).toEqual({
      completed: true, stoppedBy: "completed", pages: 1, received: 3,
      upserted: 3, needsAttention: false,
    });
    expect(JSON.stringify(body)).not.toContain("error");
  });

  it("500 si falta el dataset", async () => {
    delete process.env.MLS_BRIDGE_DATASET;
    expect((await GET(pedir(`Bearer ${SECRET}`))).status).toBe(500);
  });
});
