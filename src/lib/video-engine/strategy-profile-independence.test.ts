// Contract tests for the two-axis invariant (ADR-0001 / gate §13): Source Strategy and
// Render Profile are INDEPENDENT axes — a new strategy needs no new profile, a new profile
// needs no new strategy, and every (strategy × profile) pair is a valid combination. These
// are pure structural assertions over the registries + the profile's expectedQaSpec.
import { describe, it, expect } from "vitest";
import { SOURCE_STRATEGIES, SOURCE_STRATEGY_REGISTRY, compositionSourceForStrategy } from "./source-strategy";
import { RENDER_PROFILES, getRenderProfile } from "./render-profiles";
import type { CompositionInput } from "./composition-input";

// A representative CompositionInput for each strategy — the shape a strategy's prepare step
// would yield. The point: a profile consumes ONLY these public fields, never the strategy id.
function sampleInputFor(strategy: (typeof SOURCE_STRATEGIES)[number]): CompositionInput {
  const src = compositionSourceForStrategy(strategy);
  if (src === "photo_slideshow") {
    return {
      source: "photo_slideshow",
      property: { addressLine: "1 A St" },
      priceLabel: "$1",
      photos: [{ url: "a" }],
      brand: { name: "Lixtara" },
      cta: { text: "x" },
      badge: null,
    };
  }
  return {
    source: "uploaded_video",
    property: { addressLine: "1 A St" },
    priceLabel: "$1",
    videoSrc: "prepared-0.mp4",
    durationSeconds: 30,
    hasAudio: false,
    brand: { name: "Lixtara" },
    cta: { text: "x" },
    badge: null,
  };
}

describe("Source Strategy × Render Profile independence (gate §13)", () => {
  it("every (strategy × profile) pair produces a valid expected-QA spec — a free product", () => {
    let pairs = 0;
    for (const strategy of SOURCE_STRATEGIES) {
      const input = sampleInputFor(strategy);
      for (const profileId of RENDER_PROFILES) {
        const profile = getRenderProfile(profileId);
        const spec = profile.expectedQaSpec(input, 20);
        expect(spec.width).toBe(profile.width);
        expect(spec.height).toBe(profile.height);
        expect(spec.fps).toBe(profile.fps);
        pairs++;
      }
    }
    expect(pairs).toBe(SOURCE_STRATEGIES.length * RENDER_PROFILES.length);
  });

  it("a profile NEVER branches on the source strategy identity — only on the input's public fields", () => {
    const standard = getRenderProfile("standard");
    // Two DIFFERENT strategies producing inputs with the SAME public audio/duration facts
    // must yield the SAME output spec: the profile can't be reading the strategy id.
    const asPhoto = standard.expectedQaSpec(
      { source: "photo_slideshow", property: { addressLine: "x" }, priceLabel: "$", photos: [{ url: "a" }], brand: { name: "L" }, cta: { text: "c" }, badge: null },
      20,
    );
    const asVideoNoAudio = standard.expectedQaSpec(
      { source: "uploaded_video", property: { addressLine: "x" }, priceLabel: "$", videoSrc: "p", durationSeconds: 5, hasAudio: false, brand: { name: "L" }, cta: { text: "c" }, badge: null },
      20,
    );
    // Same audioExpected (both false) + same duration input ⇒ identical dims/codec/audio verdict.
    expect(asPhoto.audioExpected).toBe(asVideoNoAudio.audioExpected);
    expect({ w: asPhoto.width, h: asPhoto.height, fps: asPhoto.fps, codec: asPhoto.codec }).toEqual({
      w: asVideoNoAudio.width,
      h: asVideoNoAudio.height,
      fps: asVideoNoAudio.fps,
      codec: asVideoNoAudio.codec,
    });
  });

  it("all strategies drive the SAME shared composition id (no per-strategy composition)", () => {
    const ids = new Set(RENDER_PROFILES.map((p) => getRenderProfile(p).compositionId));
    expect([...ids]).toEqual(["ListingVideo"]);
    // And every strategy's descriptor points at a composition-input arm, not a bespoke composition.
    for (const s of SOURCE_STRATEGIES) {
      expect(typeof SOURCE_STRATEGY_REGISTRY[s].compositionInputSource).toBe("string");
    }
  });

  it("adding a strategy does not require enumerating profiles (registries are keyed independently)", () => {
    // Structural: the two registries share no keys / no cross-references.
    const strategyKeys = new Set<string>(SOURCE_STRATEGIES);
    const profileKeys = new Set<string>(RENDER_PROFILES);
    for (const k of strategyKeys) expect(profileKeys.has(k)).toBe(false);
    for (const k of profileKeys) expect(strategyKeys.has(k)).toBe(false);
  });
});
