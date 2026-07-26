import { describe, it, expect } from "vitest";
import {
  archiveAsset,
  archiveAssets,
  type ArchiveCommand,
  type ArchiveOutcome,
  type ArchiveWriter,
  type ListingArchivePlan,
} from "./source-archive";

// Fake ArchiveWriter — records every command it receives and returns a scripted outcome. No
// Supabase, no SQL, no DB. Default outcome is "archived"; a behavior fn can vary it per command.
function fakeWriter(behavior?: (cmd: ArchiveCommand) => ArchiveOutcome | Promise<ArchiveOutcome>) {
  const calls: ArchiveCommand[] = [];
  const writer: ArchiveWriter = {
    async archive(cmd) {
      calls.push(cmd);
      return behavior ? behavior(cmd) : "archived";
    },
  };
  return { writer, calls };
}

const OPTS = { reason: "retention_batch", runId: "run-1" };

const plan = (o: Partial<ListingArchivePlan> = {}): ListingArchivePlan => {
  const orphanIds = o.orphanIds ?? ["a1", "a2", "a3"];
  return {
    listingId: "L1",
    ownerId: "O1",
    currentId: "cur-L1",
    orphanIds,
    // Stage C: lifecycle-at-classification per orphan (audit prevLifecycle). Seller sources
    // are invariantly 'draft'; tests may override per id.
    prevLifecycleById: Object.fromEntries(orphanIds.map((id) => [id, "draft"])),
    ...o,
  };
};

describe("archiveAsset (single primitive)", () => {
  const cmd: ArchiveCommand = {
    assetId: "a1", ownerId: "O1", currentId: "cur", reason: "r", runId: "run",
    audit: { listingId: "L1", prevLifecycle: "draft" },
  };

  it("wraps the writer's outcome into a result", async () => {
    const { writer } = fakeWriter(() => "already_archived");
    expect(await archiveAsset(writer, cmd)).toEqual({ assetId: "a1", outcome: "already_archived" });
  });

  it("is transparent — PROPAGATES the writer's exception (does not represent it as a result)", async () => {
    const writer: ArchiveWriter = {
      async archive() {
        throw new Error("boom");
      },
    };
    await expect(archiveAsset(writer, cmd)).rejects.toThrow("boom");
  });
});

describe("archiveAssets — executor makes no decisions", () => {
  it("passes the writer EXACTLY the plan's orphan ids, in order, and nothing else", async () => {
    const { writer, calls } = fakeWriter();
    const plans = [
      plan({ listingId: "L1", ownerId: "O1", currentId: "cur-L1", orphanIds: ["a1", "a2", "a3"] }),
      plan({ listingId: "L2", ownerId: "O2", currentId: "cur-L2", orphanIds: ["b1", "b2"] }),
    ];
    await archiveAssets(writer, plans, OPTS);
    // exactly the plan's orphans, in the plan's order — no extra, no missing, no reorder
    expect(calls.map((c) => c.assetId)).toEqual(["a1", "a2", "a3", "b1", "b2"]);
    // no candidate outside the union of the plans' orphanIds
    const allowed = new Set(["a1", "a2", "a3", "b1", "b2"]);
    expect(calls.every((c) => allowed.has(c.assetId))).toBe(true);
    expect(calls).toHaveLength(5);
  });

  it("passes the writer EXACTLY each plan's currentId (never a recomputed one)", async () => {
    const { writer, calls } = fakeWriter();
    const plans = [
      plan({ ownerId: "O1", currentId: "cur-L1", orphanIds: ["a1", "a2"] }),
      plan({ listingId: "L2", ownerId: "O2", currentId: "cur-L2", orphanIds: ["b1"] }),
    ];
    await archiveAssets(writer, plans, OPTS);
    expect(calls.filter((c) => c.assetId.startsWith("a")).every((c) => c.currentId === "cur-L1")).toBe(true);
    expect(calls.filter((c) => c.assetId.startsWith("b")).every((c) => c.currentId === "cur-L2")).toBe(true);
    // owner also comes verbatim from the plan
    expect(calls.filter((c) => c.assetId.startsWith("a")).every((c) => c.ownerId === "O1")).toBe(true);
  });

  it("does NOT filter, even a malformed plan whose orphan equals currentId — it forwards; the writer decides", async () => {
    // The executor must not make the current-protection decision itself. It passes the id through;
    // the writer's guard returns skipped_current. (No silent drop = no executor decision-making.)
    const { writer, calls } = fakeWriter((c) => (c.assetId === c.currentId ? "skipped_current" : "archived"));
    const plans = [plan({ currentId: "cur-L1", orphanIds: ["a1", "cur-L1", "a3"] })];
    const summary = await archiveAssets(writer, plans, OPTS);
    expect(calls.map((c) => c.assetId)).toEqual(["a1", "cur-L1", "a3"]); // forwarded, not filtered
    expect(summary.results.find((r) => r.assetId === "cur-L1")?.outcome).toBe("skipped_current");
  });

  it("forwards the run correlation (reason, runId) unchanged", async () => {
    const { writer, calls } = fakeWriter();
    await archiveAssets(writer, [plan({ orphanIds: ["a1"] })], { reason: "retention_batch", runId: "run-XYZ" });
    expect(calls[0]).toMatchObject({ reason: "retention_batch", runId: "run-XYZ" });
  });

  it("forwards the plan's audit data (listingId, prevLifecycle) verbatim — never invents it", async () => {
    const { writer, calls } = fakeWriter();
    await archiveAssets(
      writer,
      [plan({ listingId: "L9", orphanIds: ["a1"], prevLifecycleById: { a1: "approved" } })],
      OPTS,
    );
    expect(calls[0]).toMatchObject({ audit: { listingId: "L9", prevLifecycle: "approved" } });
  });

  it("a plan orphan without prevLifecycle is a recorded data error — the executor never invents a value", async () => {
    const { writer, calls } = fakeWriter();
    const summary = await archiveAssets(
      writer,
      [plan({ orphanIds: ["a1", "a2"], prevLifecycleById: { a1: "draft" } })], // a2 missing
      OPTS,
    );
    expect(calls.map((c) => c.assetId)).toEqual(["a1"]); // a2 never reaches the writer
    expect(summary.results).toEqual([
      { assetId: "a1", outcome: "archived" },
      { assetId: "a2", outcome: "error", error: "plan_missing_prevLifecycle" },
    ]);
  });
});

describe("archiveAssets — ordering, aggregation, independence", () => {
  it("preserves plan order in the results", async () => {
    const { writer } = fakeWriter();
    const summary = await archiveAssets(
      writer,
      [plan({ orphanIds: ["a1", "a2"] }), plan({ listingId: "L2", orphanIds: ["b1"] })],
      OPTS,
    );
    expect(summary.results.map((r) => r.assetId)).toEqual(["a1", "a2", "b1"]);
  });

  it("aggregates counts per outcome correctly", async () => {
    const script: Record<string, ArchiveOutcome> = {
      a1: "archived",
      a2: "already_archived",
      a3: "archived",
      b1: "not_found_or_not_owner",
    };
    const { writer } = fakeWriter((c) => script[c.assetId]);
    const summary = await archiveAssets(
      writer,
      [plan({ orphanIds: ["a1", "a2", "a3"] }), plan({ listingId: "L2", orphanIds: ["b1"] })],
      OPTS,
    );
    expect(summary.counts).toEqual({
      archived: 2,
      already_archived: 1,
      not_found_or_not_owner: 1,
      skipped_current: 0,
      error: 0,
    });
  });

  it("on a partial error, records it and CONTINUES the batch (no rollback, independent ops)", async () => {
    const { writer, calls } = fakeWriter((c) => {
      if (c.assetId === "a2") throw new Error("writer failed on a2");
      return "archived";
    });
    const summary = await archiveAssets(writer, [plan({ orphanIds: ["a1", "a2", "a3"] })], OPTS);
    // every asset was still attempted (batch did not abort)
    expect(calls.map((c) => c.assetId)).toEqual(["a1", "a2", "a3"]);
    expect(summary.results).toEqual([
      { assetId: "a1", outcome: "archived" },
      { assetId: "a2", outcome: "error", error: "writer failed on a2" },
      { assetId: "a3", outcome: "archived" },
    ]);
    expect(summary.counts.archived).toBe(2);
    expect(summary.counts.error).toBe(1);
  });

  it("empty plans / empty orphans → empty results, all counts zero", async () => {
    const { writer, calls } = fakeWriter();
    const summary = await archiveAssets(writer, [plan({ orphanIds: [] })], OPTS);
    expect(calls).toHaveLength(0);
    expect(summary.results).toEqual([]);
    expect(summary.counts).toEqual({
      archived: 0,
      already_archived: 0,
      not_found_or_not_owner: 0,
      skipped_current: 0,
      error: 0,
    });
  });

  it("no additional candidate is ever produced (writer call count === total plan orphans)", async () => {
    const { writer, calls } = fakeWriter();
    const plans = [plan({ orphanIds: ["a1", "a2"] }), plan({ listingId: "L2", orphanIds: ["b1", "b2", "b3"] })];
    await archiveAssets(writer, plans, OPTS);
    const totalOrphans = plans.reduce((n, p) => n + p.orphanIds.length, 0);
    expect(calls).toHaveLength(totalOrphans);
  });
});
