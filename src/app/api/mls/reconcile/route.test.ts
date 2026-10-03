import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/mls/reconcile-store.supabase", () => ({ createSupabaseReconcileStore: () => ({}) }));
vi.mock("@/lib/mls/bridge-adapter", () => ({ createBridgeProvider: () => ({ dataset: "mia" }) }));
const run = vi.fn(async () => ({
  dataset: "mia", outcome: "ok", started: true, restartedStale: false, pages: 20,
  keysReceived: 40000, keysSeen: 32000, stored: 32100, deleted: 100,
  stoppedBy: "completed", error: null,
}));
vi.mock("@/lib/mls/reconcile-run", () => ({
  runMlsReconciliation: () => run(),
  reconcileNeedsAttention: () => ({ attention: false }),
}));

import { GET } from "./route";

const SECRET = "secreto-de-cron-para-pruebas";
const pedir = (auth?: string) =>
  new Request("https://lixtara.com/api/mls/reconcile", auth ? { headers: { authorization: auth } } : undefined);

const env = { ...process.env };
beforeEach(() => {
  run.mockClear();
  process.env.CRON_SECRET = SECRET;
  process.env.VERCEL_ENV = "production";
  process.env.MLS_SYNC_ENABLED = "true";
  process.env.MLS_BRIDGE_DATASET = "mia";
  delete process.env.MLS_FEED_ENABLED;
  delete process.env.MLS_DISPLAY_ENABLED;
});
afterEach(() => { process.env = { ...env }; });

describe("/api/mls/reconcile — mismas puertas que la sincronización", () => {
  it("401 sin el secreto del cron, sin llegar a reconciliar", async () => {
    expect((await GET(pedir("Bearer malo"))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("404 fuera de producción", async () => {
    process.env.VERCEL_ENV = "preview";
    expect((await GET(pedir(`Bearer ${SECRET}`))).status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it("404 con la sincronización apagada, aunque la exhibición esté encendida", async () => {
    delete process.env.MLS_SYNC_ENABLED;
    process.env.MLS_DISPLAY_ENABLED = "true";
    expect((await GET(pedir(`Bearer ${SECRET}`))).status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it("500 sin dataset", async () => {
    delete process.env.MLS_BRIDGE_DATASET;
    expect((await GET(pedir(`Bearer ${SECRET}`))).status).toBe(500);
  });

  it("200 con conteos y sin claves ni errores crudos", async () => {
    const r = await GET(pedir(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      outcome: "ok", stoppedBy: "completed", pages: 20, keysSeen: 32000,
      stored: 32100, deleted: 100, needsAttention: false,
    });
  });
});
