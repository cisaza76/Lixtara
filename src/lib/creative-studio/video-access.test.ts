import { describe, it, expect, vi } from "vitest";
import {
  requireVideoFeatureAccess,
  type AccessReader,
  type VideoAccessDeps,
  type VideoAccessGrant,
} from "@/lib/creative-studio/video-access";

const USER = "11111111-1111-1111-1111-111111111111";
const LISTING = "22222222-2222-2222-2222-222222222222";
const OTHER_LISTING = "33333333-3333-3333-3333-333333333333";
const NOW = Date.parse("2026-07-27T12:00:00.000Z");

function grant(o: Partial<VideoAccessGrant> = {}): VideoAccessGrant {
  return {
    id: "g1", userId: USER, listingId: LISTING, enabled: true,
    maxGenerations: 1, generationsUsed: 0, validFrom: null, validUntil: null, revokedAt: null, ...o,
  };
}

function deps(grants: VideoAccessGrant[] | (() => Promise<VideoAccessGrant[]>), sentry?: unknown): VideoAccessDeps {
  const reader: AccessReader = {
    listActiveGrants: typeof grants === "function" ? grants : async () => grants,
  };
  return { reader, now: () => NOW, sentry: (sentry as VideoAccessDeps["sentry"]) ?? null };
}

const call = (d: VideoAccessDeps, listingId = LISTING) =>
  requireVideoFeatureAccess(d, { userId: USER, listingId });

describe("requireVideoFeatureAccess — grants that authorize", () => {
  it("valid per-listing grant → allowed with remaining + grantId", async () => {
    const r = await call(deps([grant({ maxGenerations: 3, generationsUsed: 1 })]));
    expect(r).toMatchObject({ allowed: true, reason: "allowed", userAllowed: true, listingAllowed: true, remainingGenerations: 2, grantId: "g1" });
  });

  it("global (listing_id null) grant authorizes any owned listing", async () => {
    const d = deps([grant({ id: "gAll", listingId: null, maxGenerations: 5 })]);
    expect((await call(d, LISTING)).allowed).toBe(true);
    expect((await call(d, OTHER_LISTING)).allowed).toBe(true);
  });

  it("prefers the listing-specific grant over the blanket one", async () => {
    const r = await call(deps([
      grant({ id: "gAll", listingId: null, maxGenerations: 9, generationsUsed: 0 }),
      grant({ id: "gSpecific", listingId: LISTING, maxGenerations: 2, generationsUsed: 2 }),
    ]));
    // specific is exhausted → quota_exhausted (not silently falling back to the blanket)
    expect(r).toMatchObject({ allowed: false, reason: "quota_exhausted", grantId: "gSpecific" });
  });
});

describe("requireVideoFeatureAccess — denials (fail-closed)", () => {
  it("empty table → no_grant, not allowed", async () => {
    expect(await call(deps([]))).toMatchObject({ allowed: false, reason: "no_grant", userAllowed: false });
  });
  it("disabled grant → disabled", async () => {
    expect(await call(deps([grant({ enabled: false })]))).toMatchObject({ allowed: false, reason: "disabled" });
  });
  it("revoked row (defensive) → revoked", async () => {
    expect(await call(deps([grant({ revokedAt: "2026-07-01T00:00:00.000Z" })]))).toMatchObject({ allowed: false, reason: "revoked" });
  });
  it("before valid_from → not_yet_valid", async () => {
    expect(await call(deps([grant({ validFrom: "2026-08-01T00:00:00.000Z" })]))).toMatchObject({ allowed: false, reason: "not_yet_valid" });
  });
  it("after valid_until → expired", async () => {
    expect(await call(deps([grant({ validUntil: "2026-07-01T00:00:00.000Z" })]))).toMatchObject({ allowed: false, reason: "expired" });
  });
  it("grant for a different listing → listing_out_of_scope (userAllowed true, but denied)", async () => {
    const r = await call(deps([grant({ listingId: OTHER_LISTING })]));
    expect(r).toMatchObject({ allowed: false, reason: "listing_out_of_scope", userAllowed: true, listingAllowed: false });
  });
  it("quota exhausted → quota_exhausted, distinguishable, carries grantId", async () => {
    const r = await call(deps([grant({ maxGenerations: 2, generationsUsed: 2 })]));
    expect(r).toMatchObject({ allowed: false, reason: "quota_exhausted", userAllowed: true, listingAllowed: true, grantId: "g1", remainingGenerations: 0 });
  });
  it("remainingGenerations never negative even if used > max (defensive)", async () => {
    const r = await call(deps([grant({ maxGenerations: 1, generationsUsed: 5 })]));
    expect(r.remainingGenerations).toBe(0);
  });
});

describe("requireVideoFeatureAccess — reader failure fails closed + logs sanitized", () => {
  it("DB error → reader_error, denied, Sentry captured WITHOUT userId/listingId/error text", async () => {
    const captured: Array<{ tags?: Record<string, string | number> }> = [];
    const sentry = { captureException: (_e: unknown, ctx?: { tags?: Record<string, string | number> }) => { captured.push(ctx ?? {}); return null; } };
    const r = await call(deps(async () => { throw new Error(`connect ECONNREFUSED ${USER} ${LISTING}`); }, sentry));
    expect(r).toMatchObject({ allowed: false, reason: "reader_error", userAllowed: false });
    expect(captured).toHaveLength(1);
    const tagStr = JSON.stringify(captured[0]);
    expect(tagStr).not.toContain(USER);
    expect(tagStr).not.toContain(LISTING);
    expect(tagStr).not.toContain("ECONNREFUSED");
    expect(captured[0].tags).toMatchObject({ surface: "video_access", outcome: "reader_error" });
  });

  it("works with no sentry client (null) — still fails closed", async () => {
    const r = await call(deps(async () => { throw new Error("boom"); }));
    expect(r).toMatchObject({ allowed: false, reason: "reader_error" });
  });
});

describe("requireVideoFeatureAccess — degenerate input", () => {
  it("missing userId or listingId → no_grant without touching the reader", async () => {
    const reader = { listActiveGrants: vi.fn(async () => [grant()]) };
    const d: VideoAccessDeps = { reader, now: () => NOW };
    expect((await requireVideoFeatureAccess(d, { userId: "", listingId: LISTING })).reason).toBe("no_grant");
    expect((await requireVideoFeatureAccess(d, { userId: USER, listingId: "" })).reason).toBe("no_grant");
    expect(reader.listActiveGrants).not.toHaveBeenCalled();
  });

  it("multiple active grants for the listing → deterministic pick, still allowed", async () => {
    const r = await call(deps([
      grant({ id: "gA", maxGenerations: 1, generationsUsed: 0 }),
      grant({ id: "gB", maxGenerations: 1, generationsUsed: 0 }),
    ]));
    expect(r.allowed).toBe(true);
    expect(r.grantId).toBe("gA"); // first specific wins
  });
});
