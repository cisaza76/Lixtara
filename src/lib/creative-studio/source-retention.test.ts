import { describe, it, expect } from "vitest";
import {
  isSellerSourceVideo,
  byRecencyThenId,
  dedupUniverse,
  deriveUniverse,
  computeListingRetention,
  aggregateReport,
  runDryRun,
  formatReportSummary,
  RETENTION_K,
  type DryRunDeps,
  type ListingRetention,
} from "./source-retention";
import type { Asset } from "@/lib/assets/types";

const OWNER = "11111111-1111-1111-1111-111111111111";
const LISTING = "22222222-2222-2222-2222-222222222222";

function asset(o: Partial<Asset> = {}): Asset {
  return {
    id: "a", listingId: LISTING, ownerId: OWNER, kind: "video", version: 1, parentAsset: null,
    sourceType: "seller_upload", sourceId: "up",
    provenance: { sourceAssetIds: [], capability: "video", engine: "asset-manager", provider: "seller_upload", prompt: null },
    storageBucket: "creative-studio", storagePath: "source/x", checksum: null, bytes: 1000,
    mime: "video/mp4", costUsd: 0, costProvider: null, createdBy: OWNER, lifecycle: "draft", qa: null, policy: null,
    createdAt: "2026-07-01T00:00:00.000Z", ...o,
  };
}
// newest-first helper: v(id, day, bytes)
const v = (id: string, day: number, bytes = 1000, o: Partial<Asset> = {}): Asset =>
  asset({ id, createdAt: `2026-07-${String(day).padStart(2, "0")}T00:00:00.000Z`, bytes, ...o });

describe("isSellerSourceVideo (shared eligibility predicate)", () => {
  it("true only for kind=video + sourceType=seller_upload", () => {
    expect(isSellerSourceVideo(asset())).toBe(true);
    expect(isSellerSourceVideo(asset({ kind: "render" }))).toBe(false);
    expect(isSellerSourceVideo(asset({ sourceType: "generated" }))).toBe(false);
    expect(isSellerSourceVideo(asset({ kind: "photo", sourceType: "property_photo" }))).toBe(false);
  });
});

describe("byRecencyThenId (deterministic order)", () => {
  it("createdAt DESC, then id DESC on ties", () => {
    const a = v("a", 5);
    const b = v("b", 10);
    const c1 = v("c", 5); // same day as a
    const sorted = [a, b, c1].sort(byRecencyThenId);
    expect(sorted.map((x) => x.id)).toEqual(["b", "c", "a"]); // b newest; c>a on id tie
  });
});

describe("dedupUniverse / deriveUniverse", () => {
  it("dedups (listingId, ownerId) and sorts deterministically", () => {
    const u = dedupUniverse([
      { listingId: "L2", ownerId: "O1" },
      { listingId: "L1", ownerId: "O2" },
      { listingId: "L1", ownerId: "O2" }, // dup
      { listingId: "L1", ownerId: "O1" },
    ]);
    expect(u).toEqual([
      { listingId: "L1", ownerId: "O1" },
      { listingId: "L1", ownerId: "O2" },
      { listingId: "L2", ownerId: "O1" },
    ]);
  });
  it("derives universe only from eligible assets", () => {
    const u = deriveUniverse([
      v("a", 1, 1000, { listingId: "L1", ownerId: "O1" }),
      v("b", 2, 1000, { listingId: "L1", ownerId: "O1" }), // same pair
      asset({ id: "r", listingId: "L2", ownerId: "O1", kind: "render", sourceType: "generated" }), // ineligible
    ]);
    expect(u).toEqual([{ listingId: "L1", ownerId: "O1" }]);
  });
});

describe("computeListingRetention — current non-null", () => {
  const key = { listingId: LISTING, ownerId: OWNER };
  it("current excluded by id; keeps K most-recent; rest are orphans; reclaimable = orphan bytes", () => {
    // 6 sources; current = newest (day 6). nonCurrent = days 5..1 (5 assets). K=3 → retain days 5,4,3; orphans days 2,1.
    const all = [v("a1", 1, 111), v("a2", 2, 222), v("a3", 3, 333), v("a4", 4, 444), v("a5", 5, 555), v("a6", 6, 666)];
    const current = all[5]; // day 6
    const r = computeListingRetention(key, current, all, 3);
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") return;
    expect(r.current.id).toBe("a6");
    expect(r.retained.map((x) => x.id)).toEqual(["a5", "a4", "a3"]);
    expect(r.orphans.map((x) => x.id)).toEqual(["a2", "a1"]);
    expect(r.reclaimableBytes).toBe(222 + 111);
  });
  it("K >= nonCurrent count → no orphans", () => {
    const all = [v("a1", 1), v("a2", 2), v("a3", 3)];
    const r = computeListingRetention(key, all[2], all, 3);
    if (r.kind !== "resolved") throw new Error("expected resolved");
    expect(r.orphans).toEqual([]);
    expect(r.reclaimableBytes).toBe(0);
    expect(r.retained.map((x) => x.id)).toEqual(["a2", "a1"]);
  });
  it("single source (= current) → empty retained + orphans", () => {
    const only = v("solo", 9, 900);
    const r = computeListingRetention(key, only, [only], 3);
    if (r.kind !== "resolved") throw new Error("expected resolved");
    expect(r.retained).toEqual([]);
    expect(r.orphans).toEqual([]);
  });
  it("ignores ineligible + other-owner assets in the listing set", () => {
    const all = [
      v("a1", 1), v("a2", 2),
      asset({ id: "photo", kind: "photo", sourceType: "property_photo", createdAt: "2026-07-09T00:00:00.000Z" }),
      v("other", 8, 1000, { ownerId: "someone-else" }),
    ];
    const r = computeListingRetention(key, all[1], all, 0); // K=0 → all nonCurrent eligible are orphans
    if (r.kind !== "resolved") throw new Error("expected resolved");
    expect(r.orphans.map((x) => x.id)).toEqual(["a1"]);
  });
  it("does NOT recompute currency — a non-newest injected current is respected", () => {
    // Authority (resolveVideoSource) said the OLDEST is current (hypothetical/forced). Engine
    // must trust it, not pick the newest itself.
    const all = [v("a1", 1), v("a2", 2), v("a3", 3)];
    const r = computeListingRetention(key, all[0], all, 1); // current = day1 (oldest)
    if (r.kind !== "resolved") throw new Error("expected resolved");
    expect(r.current.id).toBe("a1");
    expect(r.retained.map((x) => x.id)).toEqual(["a3"]); // newest of the remainder
    expect(r.orphans.map((x) => x.id)).toEqual(["a2"]);
  });
});

describe("computeListingRetention — alreadyArchived bucket (F4.6 Stage B)", () => {
  const key = { listingId: LISTING, ownerId: OWNER };

  it("separates archived non-current assets from fresh orphans; excluded from reclaimableBytes", () => {
    // 6 sources; current = day 6. Days 1 and 2 are already archived (a prior run's orphans).
    // K=3 → actives days 5,4,3 all retained; NO fresh orphans; archived reported separately.
    const all = [
      v("a1", 1, 111, { lifecycle: "archived" }),
      v("a2", 2, 222, { lifecycle: "archived" }),
      v("a3", 3, 333),
      v("a4", 4, 444),
      v("a5", 5, 555),
      v("a6", 6, 666),
    ];
    const r = computeListingRetention(key, all[5], all, 3);
    if (r.kind !== "resolved") throw new Error("expected resolved");
    expect(r.retained.map((x) => x.id)).toEqual(["a5", "a4", "a3"]);
    expect(r.orphans).toEqual([]);
    expect(r.reclaimableBytes).toBe(0);
    expect(r.alreadyArchived.map((x) => x.id)).toEqual(["a2", "a1"]); // byRecencyThenId order
  });

  it("archived assets do not consume retained (K) slots — actives are classified on their own", () => {
    // current = day 6; a5 (day 5) archived externally. K=2 over actives → retain days 4,3; orphan day 2.
    const all = [v("a2", 2, 222), v("a3", 3, 333), v("a4", 4, 444), v("a5", 5, 555, { lifecycle: "archived" }), v("a6", 6, 666)];
    const r = computeListingRetention(key, all[4], all, 2);
    if (r.kind !== "resolved") throw new Error("expected resolved");
    expect(r.retained.map((x) => x.id)).toEqual(["a4", "a3"]);
    expect(r.orphans.map((x) => x.id)).toEqual(["a2"]);
    expect(r.reclaimableBytes).toBe(222);
    expect(r.alreadyArchived.map((x) => x.id)).toEqual(["a5"]);
  });

  it("re-run consistency: archiving run-1 orphans yields a fixpoint (orphans=[]; alreadyArchived=them)", () => {
    const run1Assets = [v("a1", 1, 111), v("a2", 2, 222), v("a3", 3, 333), v("a4", 4, 444), v("a5", 5, 555), v("a6", 6, 666)];
    const run1 = computeListingRetention(key, run1Assets[5], run1Assets, 3);
    if (run1.kind !== "resolved") throw new Error("expected resolved");
    expect(run1.orphans.map((x) => x.id)).toEqual(["a2", "a1"]);

    // Simulate the executor archiving exactly run 1's orphans, then re-run the engine.
    const archivedIds = new Set(run1.orphans.map((x) => x.id));
    const run2Assets = run1Assets.map((a) => (archivedIds.has(a.id) ? { ...a, lifecycle: "archived" as const } : a));
    const run2 = computeListingRetention(key, run2Assets[5], run2Assets, 3);
    if (run2.kind !== "resolved") throw new Error("expected resolved");
    expect(run2.orphans).toEqual([]); // no longer reported as reclaimable
    expect(run2.reclaimableBytes).toBe(0);
    expect(run2.alreadyArchived.map((x) => x.id)).toEqual(["a2", "a1"]);
    expect(run2.current.id).toBe("a6");
    expect(run2.retained.map((x) => x.id)).toEqual(["a5", "a4", "a3"]);

    // Fixpoint: a third run over the same state is identical.
    const run3 = computeListingRetention(key, run2Assets[5], run2Assets, 3);
    expect(run3).toEqual(run2);
  });

  it("selection untouched: the injected current is trusted verbatim even if archived", () => {
    // Defensive invariant — F4.6 never archives the current, but if the authority hands one in,
    // the engine must NOT reclassify it into alreadyArchived or recompute currency.
    const all = [v("a1", 1, 111), v("a2", 2, 222, { lifecycle: "archived" })];
    const r = computeListingRetention(key, all[1], all, 0);
    if (r.kind !== "resolved") throw new Error("expected resolved");
    expect(r.current.id).toBe("a2");
    expect(r.alreadyArchived).toEqual([]); // current never lands in the bucket
    expect(r.orphans.map((x) => x.id)).toEqual(["a1"]);
  });

  it("several archived assets keep deterministic byRecencyThenId order — identical across runs", () => {
    // Archived on days 5, 3, and two on day 1 (id tie broken DESC). Actives on days 2, 4.
    const all = [
      v("zA", 1, 10, { lifecycle: "archived" }),
      v("zB", 1, 20, { lifecycle: "archived" }), // same day as zA → id DESC: zB before zA
      v("a2", 2, 222),
      v("z3", 3, 30, { lifecycle: "archived" }),
      v("a4", 4, 444),
      v("z5", 5, 50, { lifecycle: "archived" }),
      v("a6", 6, 666),
    ];
    const r1 = computeListingRetention(key, all[6], all, 1);
    const r2 = computeListingRetention(key, all[6], all, 1);
    if (r1.kind !== "resolved") throw new Error("expected resolved");
    expect(r1.alreadyArchived.map((x) => x.id)).toEqual(["z5", "z3", "zB", "zA"]);
    expect(r2).toEqual(r1); // same input → same order and classification
  });

  it("no asset appears in more than one bucket — full partition of the eligible set", () => {
    const all = [
      v("z1", 1, 10, { lifecycle: "archived" }),
      v("a2", 2, 222),
      v("z3", 3, 30, { lifecycle: "archived" }),
      v("a4", 4, 444),
      v("a5", 5, 555),
      v("a6", 6, 666),
    ];
    const r = computeListingRetention(key, all[5], all, 2);
    if (r.kind !== "resolved") throw new Error("expected resolved");
    const buckets = [[r.current.id], r.retained.map((x) => x.id), r.orphans.map((x) => x.id), r.alreadyArchived.map((x) => x.id)];
    const flat = buckets.flat();
    expect(new Set(flat).size).toBe(flat.length); // pairwise disjoint
    expect([...flat].sort()).toEqual(all.map((a) => a.id).sort()); // every eligible asset in exactly one bucket
  });

  it("presence of archived assets never changes the current", () => {
    const actives = [v("a1", 1, 111), v("a2", 2, 222), v("a3", 3, 333)];
    const withArchived = [...actives, v("z8", 8, 80, { lifecycle: "archived" }), v("z9", 9, 90, { lifecycle: "archived" })];
    const rBase = computeListingRetention(key, actives[2], actives, 1);
    const rWith = computeListingRetention(key, actives[2], withArchived, 1);
    if (rBase.kind !== "resolved" || rWith.kind !== "resolved") throw new Error("expected resolved");
    // current is the injected authority decision in both — archived assets (even NEWER ones)
    // play no part in currency.
    expect(rWith.current).toEqual(rBase.current);
    expect(rWith.retained).toEqual(rBase.retained);
    expect(rWith.orphans).toEqual(rBase.orphans);
    expect(rWith.alreadyArchived.map((x) => x.id)).toEqual(["z9", "z8"]);
  });

  it("mixed scenario: current + retained + fresh orphans + alreadyArchived all populated", () => {
    const all = [
      v("z1", 1, 10, { lifecycle: "archived" }),
      v("o2", 2, 222),
      v("o3", 3, 333),
      v("r4", 4, 444),
      v("r5", 5, 555),
      v("z6", 6, 60, { lifecycle: "archived" }),
      v("c7", 7, 777),
    ];
    const r = computeListingRetention(key, all[6], all, 2);
    if (r.kind !== "resolved") throw new Error("expected resolved");
    expect(r.current.id).toBe("c7");
    expect(r.retained.map((x) => x.id)).toEqual(["r5", "r4"]);
    expect(r.orphans.map((x) => x.id)).toEqual(["o3", "o2"]);
    expect(r.alreadyArchived.map((x) => x.id)).toEqual(["z6", "z1"]);
    expect(r.reclaimableBytes).toBe(333 + 222); // fresh orphans only — never archived bytes
  });

  it("parity when no asset is archived: classification identical to pre-Stage-B semantics", () => {
    // Same fixture as the baseline K-split test — Stage B must be a no-op here beyond the
    // (empty) alreadyArchived field.
    const all = [v("a1", 1, 111), v("a2", 2, 222), v("a3", 3, 333), v("a4", 4, 444), v("a5", 5, 555), v("a6", 6, 666)];
    const r = computeListingRetention(key, all[5], all, 3);
    expect(r).toEqual({
      kind: "resolved",
      listingId: LISTING,
      ownerId: OWNER,
      current: { id: "a6", createdAt: "2026-07-06T00:00:00.000Z", bytes: 666 },
      retained: [
        { id: "a5", createdAt: "2026-07-05T00:00:00.000Z", bytes: 555 },
        { id: "a4", createdAt: "2026-07-04T00:00:00.000Z", bytes: 444 },
        { id: "a3", createdAt: "2026-07-03T00:00:00.000Z", bytes: 333 },
      ],
      orphans: [
        { id: "a2", createdAt: "2026-07-02T00:00:00.000Z", bytes: 222 },
        { id: "a1", createdAt: "2026-07-01T00:00:00.000Z", bytes: 111 },
      ],
      alreadyArchived: [],
      reclaimableBytes: 333,
    });
  });

  it("ineligible or other-owner archived assets are ignored entirely — not even alreadyArchived", () => {
    const all = [
      v("a1", 1, 111),
      v("a2", 2, 222),
      asset({ id: "zPhoto", kind: "photo", sourceType: "property_photo", lifecycle: "archived", createdAt: "2026-07-03T00:00:00.000Z" }),
      asset({ id: "zGen", sourceType: "generated", lifecycle: "archived", createdAt: "2026-07-04T00:00:00.000Z" }),
      v("zOther", 5, 50, { ownerId: "someone-else", lifecycle: "archived" }),
    ];
    const r = computeListingRetention(key, all[1], all, 0); // K=0 → eligible nonCurrent all orphan
    if (r.kind !== "resolved") throw new Error("expected resolved");
    expect(r.alreadyArchived).toEqual([]); // eligibility filter runs BEFORE the lifecycle split
    expect(r.orphans.map((x) => x.id)).toEqual(["a1"]);
  });
});

describe("computeListingRetention — current null (unresolvedCurrent)", () => {
  it("classifies separately, records reason, lists ids, NOT counted as orphans", () => {
    const all = [v("a1", 1, 111), v("a2", 2, 222)];
    const r = computeListingRetention({ listingId: LISTING, ownerId: OWNER }, null, all, 3);
    expect(r).toEqual({
      kind: "unresolvedCurrent",
      listingId: LISTING,
      ownerId: OWNER,
      sourceAssetCount: 2,
      assetIds: ["a2", "a1"], // deterministic order
      reason: "resolveVideoSource_returned_null",
    });
  });
});

describe("aggregateReport", () => {
  const results: ListingRetention[] = [
    { kind: "resolved", listingId: "L1", ownerId: "O", current: { id: "c1", createdAt: "d", bytes: 1 }, retained: [], orphans: [{ id: "o1", createdAt: "d", bytes: 500 }, { id: "o2", createdAt: "d", bytes: 300 }], alreadyArchived: [{ id: "z1", createdAt: "d", bytes: 50 }], reclaimableBytes: 800 },
    { kind: "resolved", listingId: "L2", ownerId: "O", current: { id: "c2", createdAt: "d", bytes: 1 }, retained: [], orphans: [{ id: "o3", createdAt: "d", bytes: 1000 }], alreadyArchived: [], reclaimableBytes: 1000 },
    { kind: "resolved", listingId: "L3", ownerId: "O", current: { id: "c3", createdAt: "d", bytes: 1 }, retained: [], orphans: [], alreadyArchived: [{ id: "z2", createdAt: "d", bytes: 60 }, { id: "z3", createdAt: "d", bytes: 70 }], reclaimableBytes: 0 },
    { kind: "unresolvedCurrent", listingId: "L4", ownerId: "O", sourceAssetCount: 2, assetIds: ["x", "y"], reason: "resolveVideoSource_returned_null" },
  ];
  const rep = aggregateReport(results, 10, 3, 10);

  it("totals exclude unresolved from reclaimable + orphans; count alreadyArchived separately", () => {
    expect(rep.totals).toEqual({
      listingsResolved: 3,
      listingsWithOrphans: 2,
      totalOrphans: 3,
      totalReclaimableBytes: 1800,
      assetsAlreadyArchived: 3,
      listingsUnresolvedCurrent: 1,
      assetsUnresolvedCurrent: 2,
    });
  });
  it("top listings by bytes, descending", () => {
    expect(rep.topListingsByBytes.map((l) => [l.listingId, l.reclaimableBytes])).toEqual([["L2", 1000], ["L1", 800]]);
  });
  it("orphan distribution sorted by orphan count", () => {
    expect(rep.orphanDistribution).toEqual([{ orphanCount: 0, listings: 1 }, { orphanCount: 1, listings: 1 }, { orphanCount: 2, listings: 1 }]);
  });
  it("carries K + universe provenance", () => {
    expect(rep.k).toBe(3);
    expect(rep.generatedFrom).toEqual({ totalEligibleAssets: 10, totalListings: 4 });
  });
});

describe("runDryRun (consumes resolveVideoSource; deterministic; read-only deps)", () => {
  const L1 = "L1", L2 = "L2", O = "O";
  const l1 = [v("a1", 1, 100, { listingId: L1, ownerId: O }), v("a2", 2, 200, { listingId: L1, ownerId: O }), v("a3", 3, 300, { listingId: L1, ownerId: O }), v("a4", 4, 400, { listingId: L1, ownerId: O }), v("a5", 5, 500, { listingId: L1, ownerId: O })];
  const l2 = [v("b1", 1, 1000, { listingId: L2, ownerId: O })];
  const allEligible = [...l1, ...l2];

  function deps(over: Partial<DryRunDeps> = {}): DryRunDeps {
    return {
      loadEligibleSourceAssets: over.loadEligibleSourceAssets ?? (async () => allEligible),
      listByListing: over.listByListing ?? (async (id) => (id === L1 ? l1 : id === L2 ? l2 : [])),
      // authority: newest wins (mirrors F3) — but injected, not reimplemented by the engine
      resolveVideoSource:
        over.resolveVideoSource ??
        (async (listingId, ownerId) => {
          const c = allEligible.filter((a) => a.listingId === listingId && a.ownerId === ownerId).sort(byRecencyThenId);
          return c[0] ?? null;
        }),
    };
  }

  it("K=3: L1 keeps current + 3, 1 orphan; L2 single source, none", async () => {
    const rep = await runDryRun(deps(), 3);
    expect(rep.totals.totalOrphans).toBe(1);
    expect(rep.totals.totalReclaimableBytes).toBe(100); // a1 (oldest of L1)
    const l1res = rep.listings.find((r) => r.listingId === L1);
    if (!l1res || l1res.kind !== "resolved") throw new Error("L1 resolved expected");
    expect(l1res.current.id).toBe("a5");
    expect(l1res.orphans.map((x) => x.id)).toEqual(["a1"]);
  });

  it("uses the injected authority, not its own selection", async () => {
    let calls = 0;
    const rep = await runDryRun(
      deps({
        resolveVideoSource: async () => {
          calls++;
          return null; // force unresolvedCurrent for every listing
        },
      }),
      3,
    );
    expect(calls).toBe(2); // one per universe pair — the authority was consulted
    expect(rep.totals.listingsResolved).toBe(0);
    expect(rep.totals.listingsUnresolvedCurrent).toBe(2);
    expect(rep.totals.totalReclaimableBytes).toBe(0);
  });

  it("is deterministic — identical input yields identical report", async () => {
    const a = await runDryRun(deps(), 3);
    const b = await runDryRun(deps(), 3);
    expect(a).toEqual(b);
  });

  it("summary is a pure function of the report", () => {
    const s = formatReportSummary(aggregateReport([], 0, RETENTION_K));
    expect(s).toContain("READ-ONLY");
    expect(s).toContain("K=3");
  });

  it("summary reports the alreadyArchived count", () => {
    const results: ListingRetention[] = [
      { kind: "resolved", listingId: "L1", ownerId: "O", current: { id: "c1", createdAt: "d", bytes: 1 }, retained: [], orphans: [], alreadyArchived: [{ id: "z1", createdAt: "d", bytes: 50 }], reclaimableBytes: 0 },
    ];
    const s = formatReportSummary(aggregateReport(results, 2, RETENTION_K));
    expect(s).toContain("Already archived: 1");
  });
});
