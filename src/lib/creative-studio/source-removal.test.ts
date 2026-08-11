import { describe, it, expect } from "vitest";
import {
  removeCurrentSource,
  VIDEO_SOURCE_REMOVED_ACTION,
  type SourceRemovalDeps,
  type RemovalAuditIdentity,
} from "./source-removal";
import type { Asset } from "@/lib/assets/types";

const OWNER = "11111111-1111-1111-1111-111111111111";
const OTHER = "99999999-9999-9999-9999-999999999999";
const LISTING = "22222222-2222-2222-2222-222222222222";

function sourceAsset(o: Partial<Asset> = {}): Asset {
  return {
    id: "src-1", listingId: LISTING, ownerId: OWNER, kind: "video", version: 1, parentAsset: null,
    sourceType: "seller_upload", sourceId: "up-1",
    provenance: { sourceAssetIds: [], capability: "video", engine: "asset-manager", provider: "seller_upload", prompt: null },
    storageBucket: "creative-studio", storagePath: "source/o/l/up-1/source.mov", checksum: null,
    bytes: 48_412_268, mime: "video/quicktime", costUsd: 0, costProvider: null, createdBy: OWNER,
    lifecycle: "draft", qa: null, policy: null, createdAt: "2026-08-11T15:20:36.913Z", ...o,
  };
}

// Espía completo: registra TODO efecto para poder afirmar tanto lo que ocurre como lo que
// NUNCA debe ocurrir (doble borrado, doble auditoría, escritura sobre otro asset).
function spyDeps(over: Partial<SourceRemovalDeps> & { assets?: Asset[] } = {}) {
  const store: Asset[] = over.assets ?? [sourceAsset()];
  const calls = {
    archive: [] as { assetId: string; ownerId: string }[],
    deleted: [] as { bucket: string; path: string }[],
    auditInserts: [] as RemovalAuditIdentity[],
    auditExists: 0,
  };
  const deps: SourceRemovalDeps = {
    resolveCurrent: over.resolveCurrent ?? (async (listingId, ownerId) =>
      store.find(
        (a) => a.listingId === listingId && a.ownerId === ownerId && a.kind === "video" &&
               a.sourceType === "seller_upload" && a.lifecycle !== "archived",
      ) ?? null),
    archive: over.archive ?? (async ({ assetId, ownerId }) => {
      calls.archive.push({ assetId, ownerId });
      const a = store.find((x) => x.id === assetId && x.ownerId === ownerId);
      if (!a) return "not_found";
      if (a.lifecycle === "archived") return "already_archived";
      a.lifecycle = "archived";
      return "archived";
    }),
    deleteObject: over.deleteObject ?? (async (bucket, path) => {
      calls.deleted.push({ bucket, path });
      return true;
    }),
    audit: over.audit ?? {
      exists: async (id) => {
        calls.auditExists += 1;
        return calls.auditInserts.some((e) => e.assetId === id.assetId && e.userId === id.userId && e.listingId === id.listingId);
      },
      insert: async (e) => { calls.auditInserts.push(e); },
    },
  };
  return { deps, calls, store };
}

describe("removeCurrentSource — camino feliz", () => {
  it("archiva el source vigente, borra su objeto y audita exactamente una vez", async () => {
    const { deps, calls, store } = spyDeps();
    const r = await removeCurrentSource(deps, { userId: OWNER, listingId: LISTING });

    expect(r).toEqual({ removed: true, assetId: "src-1", storageDeleted: true });
    expect(calls.archive).toEqual([{ assetId: "src-1", ownerId: OWNER }]);
    expect(calls.deleted).toEqual([{ bucket: "creative-studio", path: "source/o/l/up-1/source.mov" }]);
    expect(calls.auditInserts).toHaveLength(1);
    expect(store[0].lifecycle).toBe("archived");
  });

  it("la fila del Asset y su provenance se conservan (solo cambia lifecycle)", async () => {
    const { deps, store } = spyDeps();
    const before = { ...store[0], provenance: { ...store[0].provenance } };
    await removeCurrentSource(deps, { userId: OWNER, listingId: LISTING });

    expect(store).toHaveLength(1); // la fila NO se borra
    expect(store[0].id).toBe(before.id);
    expect(store[0].provenance).toEqual(before.provenance);
    expect(store[0].storagePath).toBe(before.storagePath); // el puntero se conserva como evidencia
    expect(store[0].bytes).toBe(before.bytes);
  });

  it("el evento de auditoría lleva listing, asset y actor — y ninguna URL firmada ni secreto", async () => {
    const { deps, calls } = spyDeps();
    await removeCurrentSource(deps, { userId: OWNER, listingId: LISTING });

    expect(calls.auditInserts[0]).toEqual({ userId: OWNER, listingId: LISTING, assetId: "src-1" });
    const payload = JSON.stringify(calls.auditInserts[0]);
    expect(payload).not.toMatch(/token|signed|secret|Bearer|https?:\/\//i);
    expect(VIDEO_SOURCE_REMOVED_ACTION).toBe("creative_studio.video_source_removed");
  });
});

describe("removeCurrentSource — idempotencia", () => {
  it("un segundo DELETE es seguro: no falla, no re-borra y no audita dos veces", async () => {
    const { deps, calls } = spyDeps();
    const first = await removeCurrentSource(deps, { userId: OWNER, listingId: LISTING });
    const second = await removeCurrentSource(deps, { userId: OWNER, listingId: LISTING });

    expect(first).toEqual({ removed: true, assetId: "src-1", storageDeleted: true });
    expect(second).toEqual({ removed: false, reason: "no_source" });
    expect(calls.archive).toHaveLength(1);      // no se reintenta como operación nueva
    expect(calls.deleted).toHaveLength(1);      // Storage se toca una sola vez
    expect(calls.auditInserts).toHaveLength(1); // sin doble auditoría
  });

  // Bajo dos DELETE concurrentes, el UPDATE condicional es el punto de serialización: solo
  // UNA llamada obtiene "archived". El perdedor ve "already_archived" y NO escribe evidencia
  // — la evidencia la escribe quien realmente archivó. Así se garantiza exactamente-una
  // auditoría sin depender de un índice único adicional.
  it("el perdedor de una carrera no escribe una segunda auditoría", async () => {
    const { deps, calls } = spyDeps({ archive: async () => "already_archived" });
    const r = await removeCurrentSource(deps, { userId: OWNER, listingId: LISTING });
    expect(r).toMatchObject({ removed: true });
    expect(calls.auditInserts).toHaveLength(0);
  });

  it("sin source vigente devuelve no_source sin tocar Storage ni auditoría", async () => {
    const { deps, calls } = spyDeps({ assets: [] });
    const r = await removeCurrentSource(deps, { userId: OWNER, listingId: LISTING });
    expect(r).toEqual({ removed: false, reason: "no_source" });
    expect(calls.archive).toHaveLength(0);
    expect(calls.deleted).toHaveLength(0);
    expect(calls.auditInserts).toHaveLength(0);
  });
});

describe("removeCurrentSource — aislamiento y no-daño", () => {
  it("nunca elige un asset de otro usuario", async () => {
    const { deps, calls } = spyDeps({ assets: [sourceAsset({ id: "ajeno", ownerId: OTHER })] });
    const r = await removeCurrentSource(deps, { userId: OWNER, listingId: LISTING });
    expect(r).toEqual({ removed: false, reason: "no_source" });
    expect(calls.archive).toHaveLength(0);
  });

  it("nunca elige un source de otro listing", async () => {
    const { deps, calls } = spyDeps({ assets: [sourceAsset({ id: "otro-listing", listingId: "33333333-3333-3333-3333-333333333333" })] });
    const r = await removeCurrentSource(deps, { userId: OWNER, listingId: LISTING });
    expect(r).toEqual({ removed: false, reason: "no_source" });
    expect(calls.deleted).toHaveLength(0);
  });

  it("NUNCA toca un asset generado: solo se elimina el source", async () => {
    const generated = sourceAsset({ id: "generado", kind: "render", sourceType: "generated", lifecycle: "ready_for_review", storagePath: "output/final.mp4" });
    const { deps, calls, store } = spyDeps({ assets: [sourceAsset(), generated] });
    await removeCurrentSource(deps, { userId: OWNER, listingId: LISTING });

    expect(calls.archive.map((c) => c.assetId)).toEqual(["src-1"]);
    expect(calls.deleted.map((d) => d.path)).toEqual(["source/o/l/up-1/source.mov"]);
    expect(store.find((a) => a.id === "generado")!.lifecycle).toBe("ready_for_review"); // intacto
  });

  it("un source ya archivado no vuelve a resolverse (Issue #118 aplicado aguas arriba)", async () => {
    const { deps, calls } = spyDeps({ assets: [sourceAsset({ lifecycle: "archived" })] });
    const r = await removeCurrentSource(deps, { userId: OWNER, listingId: LISTING });
    expect(r).toEqual({ removed: false, reason: "no_source" });
    expect(calls.archive).toHaveLength(0);
  });
});

describe("removeCurrentSource — degradación", () => {
  it("si Storage falla, el archivado manda: removed:true con storageDeleted:false y sin excepción", async () => {
    const { deps, calls } = spyDeps({ deleteObject: async () => false });
    const r = await removeCurrentSource(deps, { userId: OWNER, listingId: LISTING });
    expect(r).toEqual({ removed: true, assetId: "src-1", storageDeleted: false });
    expect(calls.auditInserts).toHaveLength(1); // el evento se registra igual
  });

  it("el archivado ocurre ANTES del borrado de Storage (nunca bytes huérfanos con asset vivo)", async () => {
    const order: string[] = [];
    const { deps } = spyDeps({
      archive: async () => { order.push("archive"); return "archived"; },
      deleteObject: async () => { order.push("storage"); return true; },
    });
    await removeCurrentSource(deps, { userId: OWNER, listingId: LISTING });
    expect(order).toEqual(["archive", "storage"]);
  });

  it("si el archivado no encuentra la fila, no se borra nada de Storage", async () => {
    const { deps, calls } = spyDeps({ archive: async () => "not_found" });
    const r = await removeCurrentSource(deps, { userId: OWNER, listingId: LISTING });
    expect(r).toEqual({ removed: false, reason: "no_source" });
    expect(calls.deleted).toHaveLength(0);
    expect(calls.auditInserts).toHaveLength(0);
  });
});
