import { describe, it, expect } from "vitest";
import { UniqueViolationError } from "@/lib/db/pg-errors";
import {
  auditGenerationRequested,
  auditAccessBlocked,
  auditQuotaConsumed,
  hasInternalConsent,
  recordInternalConsent,
  VIDEO_GENERATION_REQUESTED_ACTION,
  VIDEO_ACCESS_BLOCKED_ACTION,
  VIDEO_QUOTA_CONSUMED_ACTION,
  VIDEO_CONSENT_RECORDED_ACTION,
  type ActivityLogPort,
} from "./video-access-audit";

interface Insert {
  user_id: string;
  property_id: string;
  action_type: string;
  description: string;
  metadata: Record<string, unknown>;
}

function fakePort(opts: { failInserts?: number; existing?: Insert[] } = {}) {
  const rows: Insert[] = [...(opts.existing ?? [])];
  let failLeft = opts.failInserts ?? 0;
  const port: ActivityLogPort = {
    async insert(row) {
      if (failLeft > 0) {
        failLeft -= 1;
        throw new Error("transient");
      }
      // emulate the partial unique index on (user_id, property_id, action_type, metadata.sourceAssetId)
      const dupe = rows.some(
        (r) =>
          r.action_type === row.action_type &&
          r.user_id === row.user_id &&
          r.property_id === row.property_id &&
          r.metadata.sourceAssetId === row.metadata.sourceAssetId &&
          row.action_type === VIDEO_CONSENT_RECORDED_ACTION,
      );
      if (dupe) throw new UniqueViolationError();
      rows.push(row as Insert);
    },
    async exists({ userId, listingId, actionType, sourceAssetId }) {
      return rows.some(
        (r) =>
          r.action_type === actionType &&
          r.user_id === userId &&
          r.property_id === listingId &&
          r.metadata.sourceAssetId === sourceAssetId,
      );
    },
  };
  return { port, rows };
}

const ev = { userId: "u1", listingId: "L1", metadata: { jobId: "j1" } };

describe("telemetry audit (append, best-effort)", () => {
  it("writes the right action_type for each event", async () => {
    const { port, rows } = fakePort();
    await auditGenerationRequested(port, ev);
    await auditAccessBlocked(port, { ...ev, metadata: { reason: "no_grant" } });
    await auditQuotaConsumed(port, ev);
    expect(rows.map((r) => r.action_type)).toEqual([
      VIDEO_GENERATION_REQUESTED_ACTION,
      VIDEO_ACCESS_BLOCKED_ACTION,
      VIDEO_QUOTA_CONSUMED_ACTION,
    ]);
  });

  it("a failed insert is swallowed (returns false) — never breaks the request", async () => {
    const { port } = fakePort({ failInserts: 1 });
    expect(await auditGenerationRequested(port, ev)).toBe(false);
  });
});

describe("internal consent (find-or-insert, structural)", () => {
  const rec = {
    userId: "u1", listingId: "L1", sourceAssetId: "s1",
    approvedBy: "admin-1", disclosureVersion: "v1", acceptedAt: "2026-07-27T00:00:00Z",
  };

  it("records once, then is idempotent (second call finds the existing event, no duplicate)", async () => {
    const { port, rows } = fakePort();
    expect(await recordInternalConsent(port, rec)).toEqual({ ensured: true });
    expect(await recordInternalConsent(port, rec)).toEqual({ ensured: true });
    expect(rows.filter((r) => r.action_type === VIDEO_CONSENT_RECORDED_ACTION)).toHaveLength(1);
    expect(rows[0]!.metadata).toMatchObject({ approvedBy: "admin-1", disclosureVersion: "v1", sourceAssetId: "s1" });
  });

  it("hasInternalConsent reflects the recorded state", async () => {
    const { port } = fakePort();
    expect(await hasInternalConsent(port, { userId: "u1", listingId: "L1", sourceAssetId: "s1" })).toBe(false);
    await recordInternalConsent(port, rec);
    expect(await hasInternalConsent(port, { userId: "u1", listingId: "L1", sourceAssetId: "s1" })).toBe(true);
  });

  it("a concurrent insert (UniqueViolationError) is treated as ensured", async () => {
    // Seed the row so the second insert path hits the unique violation after a forced exists=false.
    const { port } = fakePort();
    await recordInternalConsent(port, rec);
    // Force the find to miss by using a port whose exists() lies once, then insert collides.
    const racing: ActivityLogPort = {
      exists: async () => false,
      insert: async () => {
        throw new UniqueViolationError();
      },
    };
    expect(await recordInternalConsent(racing, rec)).toEqual({ ensured: true });
  });

  it("exhausts retries on persistent transient failure → ensured:false", async () => {
    const { port } = fakePort({ failInserts: 5 });
    expect(await recordInternalConsent(port, rec, { maxAttempts: 2 })).toEqual({ ensured: false });
  });
});
