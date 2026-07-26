import { describe, it, expect } from "vitest";
import { SupabaseArchiveWriter, type ArchiveWriterClient } from "./source-archive.supabase";
import { SOURCE_ASSET_ARCHIVED_ACTION } from "./source-archive-audit";
import type { ArchiveCommand } from "./source-archive";

// ── Stateful fake of the service client ────────────────────────────────────────────────────
// Interprets EXACTLY the chains the writer builds — no network, no Supabase. The update chain
// applies the same guard semantics the real WHERE would (single-row, conditional), so
// idempotency/retry tests exercise true converge-on-retry behavior against in-memory state.

interface AssetRow {
  id: string;
  owner_id: string;
  listing_id: string;
  lifecycle: string;
  archived_at: string | null;
}
interface AuditRow {
  user_id: string;
  property_id: string;
  action_type: string;
  description: string;
  metadata: Record<string, unknown>;
}

function fakeDb(seed: AssetRow[], opts: { failAuditInserts?: number } = {}) {
  const assets = new Map(seed.map((r) => [r.id, { ...r }]));
  const auditRows: AuditRow[] = [];
  const tablesTouched: string[] = [];
  const assetInserts: unknown[] = [];
  let storageTouched = 0;
  let auditInsertFailuresLeft = opts.failAuditInserts ?? 0;

  function assetsUpdateChain(values: Record<string, unknown>) {
    const eqs: Record<string, string> = {};
    const neqs: Record<string, string> = {};
    const chain = {
      eq(col: string, v: string) {
        eqs[col] = v;
        return chain;
      },
      neq(col: string, v: string) {
        neqs[col] = v;
        return chain;
      },
      select() {
        // Same semantics as the SQL WHERE: all guards must pass for the single row to flip.
        const row = assets.get(eqs.id ?? "");
        const matches =
          !!row &&
          row.owner_id === eqs.owner_id &&
          row.id !== neqs.id &&
          row.lifecycle !== neqs.lifecycle;
        if (matches && row) {
          row.lifecycle = String(values.lifecycle);
          row.archived_at = String(values.archived_at);
          return Promise.resolve({ data: [{ id: row.id, listing_id: row.listing_id }], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      },
    };
    return chain;
  }

  function assetsSelectChain() {
    const eqs: Record<string, string> = {};
    const chain = {
      eq(col: string, v: string) {
        eqs[col] = v;
        return chain;
      },
      limit() {
        return chain;
      },
      async maybeSingle() {
        const row = assets.get(eqs.id ?? "") ?? null;
        return { data: row ? { ...row } : null, error: null };
      },
    };
    return chain;
  }

  function auditSelectChain() {
    const eqs: Record<string, string> = {};
    const chain = {
      eq(col: string, v: string) {
        eqs[col] = v;
        return chain;
      },
      limit() {
        return chain;
      },
      async maybeSingle() {
        const found = auditRows.find(
          (r) =>
            r.action_type === eqs.action_type &&
            r.user_id === eqs.user_id &&
            r.property_id === eqs.property_id &&
            String(r.metadata.assetId) === eqs["metadata->>assetId"],
        );
        return { data: found ? { id: "evt" } : null, error: null };
      },
    };
    return chain;
  }

  const client: ArchiveWriterClient = {
    from(table: string) {
      tablesTouched.push(table);
      if (table === "assets") {
        return {
          update: (values: Record<string, unknown>) => assetsUpdateChain(values),
          select: () => assetsSelectChain(),
          insert: (row: Record<string, unknown>) => {
            assetInserts.push(row); // the writer must NEVER do this (AssetStore stays append-only elsewhere)
            return Promise.resolve({ error: null });
          },
        } as ReturnType<ArchiveWriterClient["from"]>;
      }
      if (table === "activity_log") {
        return {
          update: () => {
            throw new Error("writer must never UPDATE activity_log (append-only)");
          },
          select: () => auditSelectChain(),
          insert: (row: Record<string, unknown>) => {
            if (auditInsertFailuresLeft > 0) {
              auditInsertFailuresLeft--;
              return Promise.resolve({ error: { code: "XX000", message: "transient" } });
            }
            const r = row as unknown as AuditRow;
            const dup = auditRows.find(
              (x) =>
                x.action_type === r.action_type &&
                x.user_id === r.user_id &&
                x.property_id === r.property_id &&
                String(x.metadata.assetId) === String(r.metadata.assetId),
            );
            if (dup) return Promise.resolve({ error: { code: "23505", message: "unique_violation" } });
            auditRows.push(r);
            return Promise.resolve({ error: null });
          },
        } as ReturnType<ArchiveWriterClient["from"]>;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  // Storage sentinel: any access to a `storage` property is recorded (the writer's client type
  // does not even expose one — this catches an untyped escape hatch at runtime too).
  const guarded = new Proxy(client as ArchiveWriterClient & { storage?: unknown }, {
    get(target, prop, receiver) {
      if (prop === "storage") {
        storageTouched++;
        return undefined;
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  return {
    client: guarded,
    assets,
    auditRows,
    tablesTouched,
    assetInserts,
    storageTouched: () => storageTouched,
  };
}

const NOW = "2026-07-25T22:00:00.000Z";
const active = (o: Partial<AssetRow> = {}): AssetRow => ({
  id: "orphan-1",
  owner_id: "O1",
  listing_id: "L1",
  lifecycle: "draft",
  archived_at: null,
  ...o,
});
const cmd = (o: Partial<ArchiveCommand> = {}): ArchiveCommand => ({
  assetId: "orphan-1",
  ownerId: "O1",
  currentId: "current-1",
  reason: "retention_batch_k3",
  runId: "run-42",
  audit: { listingId: "L1", prevLifecycle: "draft" },
  ...o,
});
const writerFor = (db: ReturnType<typeof fakeDb>, opts: { auditMaxAttempts?: number } = {}) =>
  new SupabaseArchiveWriter(db.client, { now: () => NOW, ...opts });

describe("SupabaseArchiveWriter — conditional UPDATE (all protection in the WHERE)", () => {
  it("successful UPDATE: flips lifecycle + archived_at atomically and returns 'archived'", async () => {
    const db = fakeDb([active()]);
    const outcome = await writerFor(db).archive(cmd());
    expect(outcome).toBe("archived");
    expect(db.assets.get("orphan-1")).toMatchObject({ lifecycle: "archived", archived_at: NOW });
  });

  it("0-row UPDATE (asset does not exist) → 'not_found_or_not_owner', no mutation anywhere", async () => {
    const db = fakeDb([]);
    const outcome = await writerFor(db).archive(cmd({ assetId: "ghost" }));
    expect(outcome).toBe("not_found_or_not_owner");
    expect(db.auditRows).toHaveLength(0);
  });

  it("already archived → 'already_archived' and NEVER a second flip (archived_at untouched)", async () => {
    const db = fakeDb([active({ lifecycle: "archived", archived_at: "2026-07-01T00:00:00.000Z" })]);
    const outcome = await writerFor(db).archive(cmd());
    expect(outcome).toBe("already_archived");
    expect(db.assets.get("orphan-1")?.archived_at).toBe("2026-07-01T00:00:00.000Z"); // first flip preserved
  });

  it("current protected: assetId === currentId → guard blocks in the WHERE → 'skipped_current'", async () => {
    const db = fakeDb([active({ id: "current-1" })]);
    const outcome = await writerFor(db).archive(cmd({ assetId: "current-1", currentId: "current-1" }));
    expect(outcome).toBe("skipped_current");
    expect(db.assets.get("current-1")?.lifecycle).toBe("draft"); // untouched
    expect(db.auditRows).toHaveLength(0);
  });

  it("wrong owner → 'not_found_or_not_owner', row untouched", async () => {
    const db = fakeDb([active({ owner_id: "someone-else" })]);
    const outcome = await writerFor(db).archive(cmd());
    expect(outcome).toBe("not_found_or_not_owner");
    expect(db.assets.get("orphan-1")?.lifecycle).toBe("draft");
    expect(db.auditRows).toHaveLength(0);
  });
});

describe("SupabaseArchiveWriter — audit (F4.1 ensure pattern on activity_log)", () => {
  it("emits exactly one audit event on a flip, with the mandated metadata", async () => {
    const db = fakeDb([active()]);
    await writerFor(db).archive(cmd());
    expect(db.auditRows).toHaveLength(1);
    expect(db.auditRows[0]).toMatchObject({
      user_id: "O1",
      property_id: "L1",
      action_type: SOURCE_ASSET_ARCHIVED_ACTION,
      metadata: {
        assetId: "orphan-1",
        listingId: "L1",
        ownerId: "O1",
        runId: "run-42",
        reason: "retention_batch_k3",
        prevLifecycle: "draft",
        archivedAt: NOW,
      },
    });
  });

  it("never duplicates the audit: a second call (already_archived path) finds the event and writes nothing", async () => {
    const db = fakeDb([active()]);
    const writer = writerFor(db);
    await writer.archive(cmd());
    const second = await writer.archive(cmd());
    expect(second).toBe("already_archived");
    expect(db.auditRows).toHaveLength(1); // find-or-insert converged — no duplicate
  });

  it("a losing concurrent audit insert (23505 from the partial unique index) is treated as ensured", async () => {
    const db = fakeDb([active()]);
    // Pre-seed the audit row as if a concurrent process just inserted it; our insert would 23505.
    db.auditRows.push({
      user_id: "O1",
      property_id: "L1",
      action_type: SOURCE_ASSET_ARCHIVED_ACTION,
      description: "",
      metadata: { assetId: "orphan-1" },
    });
    const outcome = await writerFor(db).archive(cmd());
    expect(outcome).toBe("archived"); // flip happened; audit already ensured by the winner
    expect(db.auditRows).toHaveLength(1);
  });

  it("retry is idempotent AND repairs a missing audit: flip durable + transient audit failure → error; retry converges", async () => {
    // 3 transient audit-insert failures exhaust the ensure attempts on call 1 (crash-equivalent).
    const db = fakeDb([active()], { failAuditInserts: 3 });
    const writer = writerFor(db);
    await expect(writer.archive(cmd())).rejects.toThrow("audit_not_ensured");
    // The FLIP was durable (safety lives in the UPDATE, not the audit)…
    expect(db.assets.get("orphan-1")).toMatchObject({ lifecycle: "archived", archived_at: NOW });
    expect(db.auditRows).toHaveLength(0); // …but the evidence is missing (the crash window)
    // Retry: exactly one flip total (unchanged archived_at), audit REPAIRED, outcome converges.
    const retry = await writer.archive(cmd());
    expect(retry).toBe("already_archived");
    expect(db.assets.get("orphan-1")?.archived_at).toBe(NOW);
    expect(db.auditRows).toHaveLength(1);
    expect(db.auditRows[0].metadata).toMatchObject({ assetId: "orphan-1", prevLifecycle: "draft" });
  });

  it("archived_at is the injected clock value, identical in the row and the audit metadata", async () => {
    const db = fakeDb([active()]);
    await writerFor(db).archive(cmd());
    expect(db.assets.get("orphan-1")?.archived_at).toBe(NOW);
    expect(db.auditRows[0].metadata.archivedAt).toBe(NOW);
  });
});

describe("SupabaseArchiveWriter — strict scope (what it must NEVER touch)", () => {
  it("never calls Storage", async () => {
    const db = fakeDb([active()]);
    await writerFor(db).archive(cmd()); // flip path
    await writerFor(db).archive(cmd({ assetId: "ghost" })); // 0-row + label path
    expect(db.storageTouched()).toBe(0);
  });

  it("never inserts into assets (no AssetStore mutation) and touches only assets + activity_log", async () => {
    const db = fakeDb([active()]);
    await writerFor(db).archive(cmd());
    expect(db.assetInserts).toHaveLength(0);
    expect(new Set(db.tablesTouched)).toEqual(new Set(["assets", "activity_log"]));
  });

  it("exposes archive() only — the port gains no AssetStore-like surface", () => {
    const writer = writerFor(fakeDb([]));
    const publicMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(writer)).filter(
      (n) => n !== "constructor" && !n.startsWith("_"),
    );
    // ensureAudit/auditPort are private helpers of the class; the ArchiveWriter PORT is archive().
    expect(publicMethods).toContain("archive");
    expect(publicMethods).not.toContain("insert");
    expect(publicMethods).not.toContain("delete");
    expect(publicMethods).not.toContain("listByListing");
  });
});
