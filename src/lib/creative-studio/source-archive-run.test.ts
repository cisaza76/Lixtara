import { describe, it, expect } from "vitest";
import {
  parseArchiveArgs,
  runArchive,
  formatArchiveRunSummary,
  DEFAULT_ARCHIVE_REASON,
  type ArchiveRunConfig,
  type ArchiveRunDeps,
} from "./source-archive-run";
import type { ArchiveCommand, ArchiveOutcome } from "./source-archive";
import type { Asset } from "@/lib/assets/types";

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────

function asset(o: Partial<Asset> = {}): Asset {
  return {
    id: "a", listingId: "L1", ownerId: "O1", kind: "video", version: 1, parentAsset: null,
    sourceType: "seller_upload", sourceId: "up",
    provenance: { sourceAssetIds: [], capability: "video", engine: "asset-manager", provider: "seller_upload", prompt: null },
    storageBucket: "creative-studio", storagePath: "source/x", checksum: null, bytes: 1000,
    mime: "video/mp4", costUsd: 0, costProvider: null, createdBy: "O1", lifecycle: "draft", qa: null, policy: null,
    createdAt: "2026-07-01T00:00:00.000Z", ...o,
  };
}
const v = (id: string, day: number, o: Partial<Asset> = {}): Asset =>
  asset({ id, createdAt: `2026-07-${String(day).padStart(2, "0")}T00:00:00.000Z`, ...o });

// Default two-listing world. L1: 6 sources (K=3 → current a6, retained a5/a4/a3, orphans a2/a1)
// plus one already-archived (z0). L2: single source (no orphans).
const L1 = [
  v("z0", 0, { lifecycle: "archived" }),
  v("a1", 1), v("a2", 2), v("a3", 3), v("a4", 4), v("a5", 5), v("a6", 6),
];
const L2 = [v("b1", 1, { listingId: "L2", ownerId: "O2" })];

interface FakeWorld {
  deps: ArchiveRunDeps;
  writerCalls: ArchiveCommand[];
  logs: string[];
  storageCalls: number;
  assetStoreMutations: number;
}

function fakeWorld(opts: {
  byListing?: Record<string, Asset[]>;
  resolver?: (listingId: string, ownerId: string) => Asset | null;
  writerBehavior?: (cmd: ArchiveCommand) => ArchiveOutcome;
} = {}): FakeWorld {
  const byListing = opts.byListing ?? { L1, L2 };
  const writerCalls: ArchiveCommand[] = [];
  const logs: string[] = [];
  const world: FakeWorld = {
    writerCalls,
    logs,
    storageCalls: 0,
    assetStoreMutations: 0,
    deps: {
      async loadUniverseRows() {
        // one row per eligible source asset (pre-dedup), like the real projection query
        return Object.values(byListing)
          .flat()
          .filter((a) => a.kind === "video" && a.sourceType === "seller_upload")
          .map((a) => ({ listingId: a.listingId, ownerId: a.ownerId }));
      },
      async listByListing(listingId) {
        return byListing[listingId] ?? [];
      },
      async resolveVideoSource(listingId, ownerId) {
        if (opts.resolver) return opts.resolver(listingId, ownerId);
        // default authority: newest eligible for listing+owner (mirrors F3) — injected, not the runner's
        const c = (byListing[listingId] ?? [])
          .filter((a) => a.kind === "video" && a.sourceType === "seller_upload" && a.ownerId === ownerId)
          .sort((x, y) => y.createdAt.localeCompare(x.createdAt) || y.id.localeCompare(x.id));
        return c[0] ?? null;
      },
      writer: {
        async archive(cmd) {
          writerCalls.push(cmd);
          return opts.writerBehavior ? opts.writerBehavior(cmd) : "archived";
        },
      },
      now: () => "2026-07-25T23:00:00.000Z",
      generateRunId: () => "run-generated",
      log: (line) => logs.push(line),
    },
  };
  return world;
}

const cfg = (o: Partial<ArchiveRunConfig> = {}): ArchiveRunConfig => ({
  mode: "dry-run",
  scope: { kind: "all" },
  runId: null,
  reason: DEFAULT_ARCHIVE_REASON,
  json: false,
  ...o,
});

// ── Flag parsing / safety gates (abort BEFORE any dependency is touched) ───────────────────

describe("parseArchiveArgs — safe by default", () => {
  it("no flags → dry-run over all (test 1)", () => {
    const r = parseArchiveArgs([]);
    if (!r.ok) throw new Error(r.error);
    expect(r.config.mode).toBe("dry-run");
    expect(r.config.scope).toEqual({ kind: "all" });
    expect(r.config.reason).toBe("source_retention_manual");
  });

  it("--apply without scope aborts (test 3)", () => {
    const r = parseArchiveArgs(["--apply"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("explicit scope");
  });

  it("--apply --all without --confirm-all aborts, reporting the required command (test 4)", () => {
    const r = parseArchiveArgs(["--apply", "--all"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("--apply --all --confirm-all");
  });

  it("--listing and --all together abort (test 5)", () => {
    const r = parseArchiveArgs(["--listing", "L1", "--all"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("mutually exclusive");
  });

  it("ignores the bare '--' separator pnpm forwards verbatim", () => {
    const r = parseArchiveArgs(["--", "--apply", "--listing", "L1"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.config.mode).toBe("apply");
    expect(r.config.scope).toEqual({ kind: "listing", listingId: "L1" });
  });

  it("empty --run-id / --reason are rejected; unknown flags are rejected", () => {
    expect(parseArchiveArgs(["--run-id", ""]).ok).toBe(false);
    expect(parseArchiveArgs(["--run-id="]).ok).toBe(false);
    expect(parseArchiveArgs(["--reason="]).ok).toBe(false);
    expect(parseArchiveArgs(["--aply"]).ok).toBe(false); // typo must never degrade the mode
  });

  it("accepts both --name=value and --name value forms; --apply --listing is a valid scope", () => {
    const a = parseArchiveArgs(["--apply", "--listing=L1", "--run-id=r9", "--reason=ops"]);
    const b = parseArchiveArgs(["--apply", "--listing", "L1", "--run-id", "r9", "--reason", "ops"]);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.config).toEqual(b.config);
    expect(a.config.mode).toBe("apply");
    expect(a.config.scope).toEqual({ kind: "listing", listingId: "L1" });
  });
});

// ── Dry-run guarantees ─────────────────────────────────────────────────────────────────────

describe("runArchive — dry-run", () => {
  it("produces ZERO writer calls (test 2) and reports the plan", async () => {
    const w = fakeWorld();
    const report = await runArchive(w.deps, cfg());
    expect(w.writerCalls).toHaveLength(0);
    expect(report.mode).toBe("dry-run");
    expect(report.apply).toBeNull();
    expect(report.totals).toMatchObject({
      listingsExamined: 2,
      listingsResolved: 2,
      freshOrphans: 2, // a2, a1
      alreadyArchived: 1, // z0
      commandsPlanned: 2,
    });
    expect(report.exitCode).toBe(0);
  });

  it("unresolved listings produce zero commands and don't block others (test 10)", async () => {
    const w = fakeWorld({ resolver: (listingId) => (listingId === "L1" ? null : L2[0]) });
    const report = await runArchive(w.deps, cfg());
    expect(report.totals.listingsUnresolved).toBe(1);
    expect(report.totals.commandsPlanned).toBe(0); // L1 unresolved contributes none; L2 has none
    expect(report.exitCode).toBe(0); // global mode: unresolved is reported, not fatal
  });

  it("--listing scope with an unknown listing → clear error, exit 1, zero writes", async () => {
    const w = fakeWorld();
    const report = await runArchive(w.deps, cfg({ scope: { kind: "listing", listingId: "ghost" } }));
    expect(report.exitCode).toBe(1);
    expect(report.errorMessage).toContain("ghost");
    expect(w.writerCalls).toHaveLength(0);
  });

  it("--listing scope with an unresolved listing → non-success, zero mutations (test on §8)", async () => {
    const w = fakeWorld({ resolver: () => null });
    const report = await runArchive(w.deps, cfg({ scope: { kind: "listing", listingId: "L1" } }));
    expect(report.exitCode).toBe(1);
    expect(report.errorMessage).toContain("unresolvedCurrent");
    expect(w.writerCalls).toHaveLength(0);
  });
});

// ── Apply guarantees ───────────────────────────────────────────────────────────────────────

describe("runArchive — apply", () => {
  const applyL1 = cfg({ mode: "apply", scope: { kind: "listing", listingId: "L1" }, runId: "run-7" });

  it("archives exactly the listing's fresh orphans, in engine order (tests 6, 12)", async () => {
    const w = fakeWorld();
    const report = await runArchive(w.deps, applyL1);
    expect(w.writerCalls.map((c) => c.assetId)).toEqual(["a2", "a1"]); // byRecencyThenId, engine's order
    expect(report.apply?.counts.archived).toBe(2);
    expect(report.exitCode).toBe(0);
  });

  it("current, retained, alreadyArchived NEVER reach the writer (tests 7, 8, 9)", async () => {
    const w = fakeWorld();
    await runArchive(w.deps, applyL1);
    const sent = new Set(w.writerCalls.map((c) => c.assetId));
    expect(sent.has("a6")).toBe(false); // current
    expect(sent.has("a5") || sent.has("a4") || sent.has("a3")).toBe(false); // retained
    expect(sent.has("z0")).toBe(false); // alreadyArchived — never a fresh candidate
  });

  it("unresolved listing under apply --all produces zero commands for it (test 10)", async () => {
    const w = fakeWorld({ resolver: (listingId) => (listingId === "L2" ? null : L1[6]) });
    const report = await runArchive(w.deps, cfg({ mode: "apply", scope: { kind: "all" }, runId: "run-7" }));
    expect(w.writerCalls.every((c) => c.audit.listingId === "L1")).toBe(true);
    expect(report.totals.listingsUnresolved).toBe(1);
    expect(report.exitCode).toBe(0);
  });

  it("listings are processed in deterministic listingId ASC order (test 11)", async () => {
    const byListing = {
      L9: [v("y1", 1, { listingId: "L9", ownerId: "O9" }), v("y2", 2, { listingId: "L9", ownerId: "O9" })],
      L1: [v("x1", 1), v("x2", 2)],
    };
    const w = fakeWorld({ byListing });
    const report = await runArchive(w.deps, cfg());
    expect(report.listings.map((l) => l.listingId)).toEqual(["L1", "L9"]);
    // and identical input yields an identical report (determinism)
    const again = await runArchive(fakeWorld({ byListing }).deps, cfg());
    expect(again.listings).toEqual(report.listings);
  });

  it("runId and reason propagate identically to every command (tests 13, 14)", async () => {
    const w = fakeWorld();
    await runArchive(w.deps, cfg({ mode: "apply", scope: { kind: "listing", listingId: "L1" }, runId: "run-XYZ", reason: "ops_window_42" }));
    expect(w.writerCalls.length).toBeGreaterThan(0);
    expect(w.writerCalls.every((c) => c.runId === "run-XYZ")).toBe(true);
    expect(w.writerCalls.every((c) => c.reason === "ops_window_42")).toBe(true);
  });

  it("a generated runId is used when none is provided; an empty runId is rejected", async () => {
    const w = fakeWorld();
    const report = await runArchive(w.deps, cfg({ runId: null }));
    expect(report.runId).toBe("run-generated");
    const w2 = fakeWorld();
    w2.deps.generateRunId = () => "  ";
    const bad = await runArchive(w2.deps, cfg({ runId: null }));
    expect(bad.exitCode).toBe(1);
    expect(bad.errorMessage).toContain("runId");
  });

  it("partial error continues with later assets; real error → exit 1 (tests 15, 16)", async () => {
    const w = fakeWorld({
      writerBehavior: (cmd) => {
        if (cmd.assetId === "a2") throw new Error("db hiccup");
        return "archived";
      },
    });
    const report = await runArchive(w.deps, applyL1);
    expect(w.writerCalls.map((c) => c.assetId)).toEqual(["a2", "a1"]); // a1 still attempted
    expect(report.apply?.counts).toMatchObject({ archived: 1, error: 1 });
    expect(report.apply?.errors).toEqual([{ assetId: "a2", error: "db hiccup" }]);
    expect(report.exitCode).toBe(1);
  });

  it("already_archived outcomes are NOT a global error (test 17)", async () => {
    const w = fakeWorld({ writerBehavior: () => "already_archived" });
    const report = await runArchive(w.deps, applyL1);
    expect(report.apply?.counts.already_archived).toBe(2);
    expect(report.apply?.counts.error).toBe(0);
    expect(report.exitCode).toBe(0);
  });

  it("apply consumes EXACTLY the plan dry-run reports (test 21)", async () => {
    const dry = await runArchive(fakeWorld().deps, cfg({ scope: { kind: "listing", listingId: "L1" } }));
    const dryOrphans = dry.listings.flatMap((l) => (l.kind === "resolved" ? l.orphans.map((o) => o.id) : []));
    const w = fakeWorld();
    await runArchive(w.deps, applyL1);
    expect(w.writerCalls.map((c) => c.assetId)).toEqual(dryOrphans); // same classification path
  });

  it("the pre-write banner is logged BEFORE the first writer call", async () => {
    const order: string[] = [];
    const w = fakeWorld();
    const innerWriter = w.deps.writer;
    w.deps.log = (line) => order.push(`log:${line}`);
    w.deps.writer = {
      archive: (c) => {
        order.push(`write:${c.assetId}`);
        return innerWriter.archive(c);
      },
    };
    await runArchive(w.deps, applyL1);
    const firstWrite = order.findIndex((e) => e.startsWith("write:"));
    const banner = order.findIndex((e) => e.includes("ARCHIVE WRITES ENABLED"));
    expect(banner).toBeGreaterThanOrEqual(0);
    expect(banner).toBeLessThan(firstWrite);
    expect(order.some((e) => e.startsWith("log:") && e.includes("runId: run-7"))).toBe(true);
  });
});

// ── Authority + strict scope ───────────────────────────────────────────────────────────────

describe("runArchive — resolveVideoSource is the sole authority (test 25)", () => {
  it("a non-newest resolver decision is honored verbatim: currentId follows the resolver", async () => {
    // Authority says the OLDEST eligible (a1) is current. The runner must NOT correct it.
    const w = fakeWorld({ resolver: (listingId) => (listingId === "L1" ? L1[1] : L2[0]) }); // a1
    await runArchive(w.deps, cfg({ mode: "apply", scope: { kind: "listing", listingId: "L1" }, runId: "run-7" }));
    expect(w.writerCalls.every((c) => c.currentId === "a1")).toBe(true);
    expect(w.writerCalls.map((c) => c.assetId)).not.toContain("a1"); // the authority's current never archived
  });

  it("the runner mutates ONLY through the writer — no Storage, no hard delete, no AssetStore writes (tests 22, 23, 24)", async () => {
    // Structural guarantee: ArchiveRunDeps exposes NO storage surface and NO AssetStore insert/
    // delete — the writer port is the single mutation seam. This test pins the dependency
    // surface so a future edit adding another write path fails loudly.
    const w = fakeWorld();
    await runArchive(w.deps, cfg({ mode: "apply", scope: { kind: "all" }, runId: "r1" }));
    expect(Object.keys(w.deps).sort()).toEqual([
      "generateRunId", "listByListing", "loadUniverseRows", "log", "now", "resolveVideoSource", "writer",
    ].sort());
    expect(w.storageCalls).toBe(0);
    expect(w.assetStoreMutations).toBe(0);
  });
});

// ── Reporting ──────────────────────────────────────────────────────────────────────────────

describe("report + summary", () => {
  it("JSON report contains the required fields (test 18)", async () => {
    const report = await runArchive(fakeWorld().deps, cfg({ mode: "apply", scope: { kind: "listing", listingId: "L1" }, runId: "run-7" }));
    expect(report).toMatchObject({
      mode: "apply",
      runId: "run-7",
      reason: "source_retention_manual",
      scope: "listing:L1",
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      exitCode: 0,
    });
    expect(report.totals).toMatchObject({
      listingsExamined: 1, listingsResolved: 1, listingsUnresolved: 0,
      currentAssets: 1, retained: 3, freshOrphans: 2, alreadyArchived: 1,
      reclaimableBytes: 2000, commandsPlanned: 2,
    });
    expect(report.apply?.counts).toMatchObject({
      archived: 2, already_archived: 0, skipped_current: 0, not_found_or_not_owner: 0, error: 0,
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/sb_secret|service_role|SUPABASE_SECRET/i);
  });

  it("human summary distinguishes dry-run from apply (test 19)", async () => {
    const dry = formatArchiveRunSummary(await runArchive(fakeWorld().deps, cfg()));
    expect(dry).toContain("DRY RUN — NO CHANGES MADE");
    expect(dry).not.toContain("WRITES ENABLED");
    const applied = formatArchiveRunSummary(
      await runArchive(fakeWorld().deps, cfg({ mode: "apply", scope: { kind: "listing", listingId: "L1" }, runId: "r" })),
    );
    expect(applied).toContain("APPLY MODE — ARCHIVE WRITES ENABLED");
    expect(applied).not.toContain("DRY RUN");
  });

  it("never claims bytes were physically freed — soft-delete language only (test 20)", async () => {
    const s = formatArchiveRunSummary(
      await runArchive(fakeWorld().deps, cfg({ mode: "apply", scope: { kind: "listing", listingId: "L1" }, runId: "r" })),
    );
    expect(s).toContain("reclaimable by future GC");
    expect(s).toContain("mark archived");
    expect(s.toLowerCase()).not.toContain("bytes deleted");
    expect(s.toLowerCase()).not.toContain("storage reclaimed");
  });
});
