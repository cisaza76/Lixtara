import { describe, it, expect } from "vitest";
import { ensureVideoSourceUploadedAudit, type AuditPort, type VideoSourceAuditEntry } from "./source-audit";
import { UniqueViolationError } from "@/lib/db/pg-errors";

const ENTRY: VideoSourceAuditEntry = {
  userId: "u1",
  listingId: "l1",
  uploadId: "up1",
  assetId: "a1",
  sizeBytes: 100,
  mimeType: "video/mp4",
};

function port(over: Partial<AuditPort> = {}): AuditPort {
  return { exists: async () => false, insert: async () => {}, ...over };
}

describe("ensureVideoSourceUploadedAudit", () => {
  it("inserts when the event is missing", async () => {
    let inserted = 0;
    const r = await ensureVideoSourceUploadedAudit(port({ insert: async () => { inserted += 1; } }), ENTRY);
    expect(r).toEqual({ ensured: true });
    expect(inserted).toBe(1);
  });
  it("skips insert when the event already exists (no duplicate)", async () => {
    let inserted = 0;
    const r = await ensureVideoSourceUploadedAudit(port({ exists: async () => true, insert: async () => { inserted += 1; } }), ENTRY);
    expect(r).toEqual({ ensured: true });
    expect(inserted).toBe(0);
  });
  it("a concurrent insert (UniqueViolation) is treated as ensured", async () => {
    const r = await ensureVideoSourceUploadedAudit(port({ insert: async () => { throw new UniqueViolationError("dup"); } }), ENTRY);
    expect(r).toEqual({ ensured: true });
  });
  it("returns not-ensured after exhausting retries on transient failures", async () => {
    let attempts = 0;
    const r = await ensureVideoSourceUploadedAudit(
      port({ insert: async () => { attempts += 1; throw new Error("db down"); } }),
      ENTRY,
      { maxAttempts: 3 },
    );
    expect(r).toEqual({ ensured: false });
    expect(attempts).toBe(3);
  });
  it("recovers on a later attempt (transient then success)", async () => {
    let calls = 0;
    const r = await ensureVideoSourceUploadedAudit(
      port({
        insert: async () => {
          calls += 1;
          if (calls === 1) throw new Error("transient");
        },
      }),
      ENTRY,
    );
    expect(r).toEqual({ ensured: true });
    expect(calls).toBe(2);
  });
});
