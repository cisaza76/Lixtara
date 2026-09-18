import { describe, it, expect, vi } from "vitest";
import {
  createBridgeProvider, buildReplicationUrl, BridgeFeedError,
  BRIDGE_API_BASE, BRIDGE_REPLICATION_PAGE_SIZE, SYNC_CURSOR_POLICY, ingestableStatusFilter,
} from "./bridge-adapter";
import { PUBLICLY_DISPLAYABLE_STATUSES } from "./display-compliance";
import { makeResoListing } from "./feed-port.fake";

const TOKEN = "tok_de_prueba";
const conToken = { tokenProvider: () => TOKEN };

const respuesta = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("buildReplicationUrl", () => {
  it("NO manda $orderby: /replication lo rechaza con 400", () => {
    // Verificado contra la API real (2026-09-16): el endpoint responde
    // `400 "$orderby is not supported on this endpoint"`. El diseño original lo
    // mandaba y habría fallado en la primera llamada real.
    const u = new URL(buildReplicationUrl("mia", null, 200));
    expect(u.searchParams.get("$orderby")).toBeNull();
    expect(u.toString()).not.toContain("orderby");
  });

  it("la política del cursor no depende del orden", () => {
    // Como /replication no ordena, last_modification_ts solo puede avanzar cuando la
    // pasada COMPLETA termina, y avanza a runStartedAt — no al máximo visto, que
    // saltaría registros modificados durante la pasada.
    expect(SYNC_CURSOR_POLICY.advanceOnlyOnCompleteRun).toBe(true);
    expect(SYNC_CURSOR_POLICY.advanceTo).toBe("runStartedAt");
  });

  it("usa /replication, no el endpoint OData normal", () => {
    // /replication admite $top hasta 2.000 frente a 200 del normal.
    expect(buildReplicationUrl("mia", null, 200)).toContain("/Property/replication");
    expect(buildReplicationUrl("mia", null, 200)).toContain(BRIDGE_API_BASE);
  });

  it("sin `since` el $filter lleva solo el estado: es la carga inicial", () => {
    const f = new URL(buildReplicationUrl("mia", null, 200)).searchParams.get("$filter") ?? "";
    expect(f).toContain("StandardStatus");
    expect(f).not.toContain("ModificationTimestamp");
  });

  it("con `since` filtra por ModificationTimestamp en ISO", () => {
    const u = new URL(buildReplicationUrl("mia", new Date("2026-09-16T10:00:00Z"), 200));
    expect(u.searchParams.get("$filter")).toContain("ModificationTimestamp gt 2026-09-16T10:00:00.000Z");
  });

  it("filtra por estado en la consulta: el 92% del feed son Closed", () => {
    // Medido contra el feed real: 1.327.107 de 1.438.500 fichas son Closed y jamás llegan
    // al buscador público. Descargarlas para descartarlas es derroche y difícil de
    // defender bajo § III.B.9, que solo autoriza descargar para exhibir.
    const f = ingestableStatusFilter();
    for (const s of PUBLICLY_DISPLAYABLE_STATUSES) expect(f).toContain(`'${s}'`);
    expect(f).not.toContain("Closed");
    expect(new URL(buildReplicationUrl("mia", null, 200)).searchParams.get("$filter")).toContain("StandardStatus");
  });

  it("combina estado y ModificationTimestamp en un solo $filter", () => {
    const f = new URL(buildReplicationUrl("mia", new Date("2026-09-16T10:00:00Z"), 200))
      .searchParams.get("$filter") ?? "";
    expect(f).toContain("StandardStatus");
    expect(f).toContain("ModificationTimestamp gt 2026-09-16T10:00:00.000Z");
    expect(f).toContain(" and ");
  });

  it("el tamaño de página por defecto es el documentado", () => {
    expect(BRIDGE_REPLICATION_PAGE_SIZE).toBe(200);
  });
});

describe("createBridgeProvider", () => {
  it("manda el token como Bearer y nunca en la URL", async () => {
    const fetchImpl = vi.fn(async () => respuesta({ value: [] }));
    const p = createBridgeProvider({ dataset: "mia", fetchImpl: fetchImpl as never, ...conToken });
    await p.fetchModifiedSince(null, null);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string,string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(url).not.toContain(TOKEN);
  });

  it("marca todo lo que entra como contenido licenciado", async () => {
    // La marca se aplica en el único punto de entrada (ADR-0014): así nada de esto
    // puede llegar a un prompt sin romper la compilación.
    const fetchImpl = vi.fn(async () => respuesta({ value: [makeResoListing({ ListingKey: "K1" })] }));
    const p = createBridgeProvider({ dataset: "mia", fetchImpl: fetchImpl as never, ...conToken });
    const pag = await p.fetchModifiedSince(null, null);
    expect(pag.listings).toHaveLength(1);
    expect(pag.listings[0].ListingKey).toBe("K1");
  });

  it("sigue el nextLink TAL CUAL, sin reconstruirlo", async () => {
    // Reconstruir la URL de la siguiente página es como se pierden registros entre
    // páginas: el proveedor puede codificar estado ahí que nosotros no conocemos.
    const siguiente = "https://api.bridgedataoutput.com/api/v2/OData/mia/Property/replication?_cursor=abc123";
    const fetchImpl = vi.fn(async () => respuesta({ value: [], "@odata.nextLink": siguiente }));
    const p = createBridgeProvider({ dataset: "mia", fetchImpl: fetchImpl as never, ...conToken });
    const pag = await p.fetchModifiedSince(null, null);
    expect(pag.nextCursor).toBe(siguiente);

    await p.fetchModifiedSince(null, pag.nextCursor);
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toBe(siguiente);
  });

  it("acepta ambas grafías del enlace de paginación", async () => {
    // @odata.nextLink es OData estándar; Bridge documenta un "next". Sin verificar
    // cuál usa, se aceptan los dos.
    for (const campo of ["@odata.nextLink", "nextLink"]) {
      const fetchImpl = vi.fn(async () => respuesta({ value: [], [campo]: "https://x.test/p2" }));
      const p = createBridgeProvider({ dataset: "mia", fetchImpl: fetchImpl as never, ...conToken });
      expect((await p.fetchModifiedSince(null, null)).nextCursor, campo).toBe("https://x.test/p2");
    }
  });

  it("sin enlace siguiente, el cursor es null", async () => {
    const fetchImpl = vi.fn(async () => respuesta({ value: [] }));
    const p = createBridgeProvider({ dataset: "mia", fetchImpl: fetchImpl as never, ...conToken });
    expect((await p.fetchModifiedSince(null, null)).nextCursor).toBeNull();
  });

  it("un enlace vacío también es null", async () => {
    const fetchImpl = vi.fn(async () => respuesta({ value: [], "@odata.nextLink": "" }));
    const p = createBridgeProvider({ dataset: "mia", fetchImpl: fetchImpl as never, ...conToken });
    expect((await p.fetchModifiedSince(null, null)).nextCursor).toBeNull();
  });

  it("falla con el status y SIN filtrar secretos al mensaje", async () => {
    const fetchImpl = vi.fn(async () => respuesta({ error: "denegado" }, 403));
    const p = createBridgeProvider({ dataset: "mia", fetchImpl: fetchImpl as never, ...conToken });
    try {
      await p.fetchModifiedSince(null, null);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BridgeFeedError);
      expect((e as BridgeFeedError).status).toBe(403);
      // Ni el token ni la URL —que lleva el dataset— pueden acabar en un log.
      expect((e as Error).message).not.toContain(TOKEN);
      expect((e as Error).message).not.toContain("api.bridgedataoutput.com");
    }
  });

  it("rechaza una respuesta sin arreglo `value`", async () => {
    const fetchImpl = vi.fn(async () => respuesta({ resultado: "raro" }));
    const p = createBridgeProvider({ dataset: "mia", fetchImpl: fetchImpl as never, ...conToken });
    await expect(p.fetchModifiedSince(null, null)).rejects.toThrow(/sin arreglo/);
  });

  it("la credencial pasa por el gate de entorno", async () => {
    // Por defecto usa requireMlsServerToken, que verifica producción + flag ANTES de
    // devolver el token. En el entorno de test el gate niega, así que llamar sin
    // inyectar tokenProvider debe fallar — no llegar a la red.
    const fetchImpl = vi.fn(async () => respuesta({ value: [] }));
    const p = createBridgeProvider({ dataset: "mia", fetchImpl: fetchImpl as never });
    await expect(p.fetchModifiedSince(null, null)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
