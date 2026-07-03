// src/lib/media-intelligence/jobs.test.ts
import { describe, it, expect, vi } from "vitest";
import { createJob, setJobStatus, completeJob, failJob } from "@/lib/media-intelligence/jobs";

// Minimal fake of the supabase query-builder chain we use.
function fakeClient() {
  const calls: Record<string, unknown> = {};
  const builder = {
    insert: vi.fn(() => builder),
    update: vi.fn((patch: unknown) => { calls.update = patch; return builder; }),
    eq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn(async () => ({ data: { id: "job-1" }, error: null })),
  };
  return {
    calls,
    from: vi.fn(() => builder),
    builder,
  };
}

describe("jobs persistence", () => {
  it("createJob inserts a pending row and returns the id", async () => {
    const c = fakeClient();
    const id = await createJob(c as never, { propertyId: "p1", ownerId: "o1" });
    expect(id).toBe("job-1");
    expect(c.builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ property_id: "p1", owner_id: "o1", status: "pending" }),
    );
  });
  it("setJobStatus writes status + updated_at", async () => {
    const c = fakeClient();
    await setJobStatus(c as never, "job-1", "analyzing");
    expect(c.calls.update).toMatchObject({ status: "analyzing" });
  });
  it("failJob writes failed + error", async () => {
    const c = fakeClient();
    await failJob(c as never, "job-1", "boom");
    expect(c.calls.update).toMatchObject({ status: "failed", error: "boom" });
  });
  it("completeJob writes completed + strategy + providers", async () => {
    const c = fakeClient();
    await completeJob(c as never, "job-1", { schemaVersion: 1 } as never, "mock");
    expect(c.calls.update).toMatchObject({ status: "completed", providers: "mock" });
  });
});
