import { describe, it, expect } from "vitest";
import { videoAccessDenial, videoVisibilityDenial, isVideoFeatureVisible } from "./video-access-guard";
import type { VideoAccessResult } from "./video-access";

const base: VideoAccessResult = {
  allowed: true, reason: "allowed", userAllowed: true, listingAllowed: true,
  remainingGenerations: 1, consentRequired: false, consentSatisfied: true, grantId: "g1", grantGenerationsUsed: 0,
};
const deny = (reason: VideoAccessResult["reason"], over: Partial<VideoAccessResult> = {}): VideoAccessResult => ({
  ...base, allowed: false, reason, listingAllowed: false, remainingGenerations: 0, consentSatisfied: false, ...over,
});

describe("videoAccessDenial (generate surface)", () => {
  it("allowed → null (proceed)", () => {
    expect(videoAccessDenial(base)).toBeNull();
  });
  it("quota_exhausted → 403 quota_exhausted (distinguishable, feature visible)", () => {
    expect(videoAccessDenial(deny("quota_exhausted"))).toEqual({ status: 403, body: { error: "quota_exhausted" } });
  });
  it("consent_required → 403 consent_required (only when consentRequired && !satisfied)", () => {
    const r = deny("no_grant", { consentRequired: true, consentSatisfied: false, userAllowed: true });
    expect(videoAccessDenial(r)).toEqual({ status: 403, body: { error: "consent_required" } });
  });
  it.each(["no_grant", "disabled", "revoked", "not_yet_valid", "expired", "listing_out_of_scope", "reader_error"] as const)(
    "%s → 404 not_found (feature invisible, incl. reader_error fail-closed)",
    (reason) => {
      expect(videoAccessDenial(deny(reason))).toEqual({ status: 404, body: { error: "not_found" } });
    },
  );
});

describe("videoVisibilityDenial / isVideoFeatureVisible (non-generating surfaces)", () => {
  it("allowed → visible (null denial)", () => {
    expect(isVideoFeatureVisible(base)).toBe(true);
    expect(videoVisibilityDenial(base)).toBeNull();
  });
  it("quota_exhausted → STILL visible (quota gates only generate)", () => {
    expect(isVideoFeatureVisible(deny("quota_exhausted"))).toBe(true);
    expect(videoVisibilityDenial(deny("quota_exhausted"))).toBeNull();
  });
  it.each(["no_grant", "disabled", "revoked", "not_yet_valid", "expired", "listing_out_of_scope", "reader_error"] as const)(
    "%s → invisible (404)",
    (reason) => {
      expect(isVideoFeatureVisible(deny(reason))).toBe(false);
      expect(videoVisibilityDenial(deny(reason))).toEqual({ status: 404, body: { error: "not_found" } });
    },
  );
});
