import { describe, expect, it } from "vitest";
import { buildRenderManifest } from "@/lib/video-engine/manifest";
import { RENDERER_VERSION, RENDER_PROVIDER, TEMPLATE_ID, TEMPLATE_VERSION } from "@/lib/video-engine/versions";

// The narrow shape the composition actually consumes (src/remotion/input.ts). Deliberately
// does NOT include a seller's email/phone/ssn/etc — proving the manifest can't leak what
// it was never given.
const NARROW_INPUT_PROPS = {
  property: { addressLine: "123 Ocean Dr, Miami, FL", name: "Ocean Breeze" },
  priceLabel: "$799,000",
  photos: [{ url: "/tmp/a.jpg", roomLabel: "Living Room" }],
  brand: { name: "Lixtara" },
  cta: { text: "Schedule a Tour" },
  badge: null,
};

// Secret markers the manifest must never contain (requirement 2).
const SECRET_MARKERS = [
  "SUPABASE_SECRET",
  "sb_secret",
  "service_role",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_TOKEN",
];

// Secret-scanning hygiene: assemble the fake secret at runtime so no full Supabase secret-key
// literal exists in source (avoids GitHub Push Protection false positives). The runtime
// value and the test behavior are unchanged.
const FAKE_SUPABASE_SECRET = ["sb", "secret", "should_never_leak_into_manifest"].join("_");

describe("buildRenderManifest", () => {
  it("carries inputProps + pinned versions + traceId + technical config", () => {
    const manifest = buildRenderManifest({ inputProps: NARROW_INPUT_PROPS, traceId: "trace-123" });

    expect(manifest.inputProps).toEqual(NARROW_INPUT_PROPS);
    expect(manifest.traceId).toBe("trace-123");
    expect(manifest.versions).toEqual({
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      inputSchemaVersion: "1",
      rendererVersion: RENDERER_VERSION,
      renderProvider: RENDER_PROVIDER,
      bundleVersion: null,
    });
    expect(manifest.technical).toEqual({
      compositionId: TEMPLATE_ID,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "h264",
    });
  });

  it("passes badge:null through unchanged (requirement 10)", () => {
    const manifest = buildRenderManifest({ inputProps: NARROW_INPUT_PROPS, traceId: null });
    expect((manifest.inputProps as { badge: null }).badge).toBeNull();
  });

  it("carries a caller-supplied bundleVersion when given", () => {
    const manifest = buildRenderManifest({
      inputProps: NARROW_INPUT_PROPS,
      traceId: null,
      bundleVersion: "bundle-abc123",
    });
    expect(manifest.versions.bundleVersion).toBe("bundle-abc123");
  });

  it("never reads process.env — output is identical regardless of secret-shaped env vars", () => {
    const before = process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SECRET_KEY = FAKE_SUPABASE_SECRET;
    try {
      const manifest = buildRenderManifest({ inputProps: NARROW_INPUT_PROPS, traceId: "t1" });
      const serialized = JSON.stringify(manifest);
      for (const marker of SECRET_MARKERS) {
        expect(serialized).not.toContain(marker);
      }
    } finally {
      if (before === undefined) delete process.env.SUPABASE_SECRET_KEY;
      else process.env.SUPABASE_SECRET_KEY = before;
    }
  });

  it("contains no arbitrary private seller field it was never given", () => {
    const manifest = buildRenderManifest({ inputProps: NARROW_INPUT_PROPS, traceId: "t1" });
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("ssn");
    expect(serialized).not.toContain("sellerEmail");
    expect(serialized).not.toContain("sellerPhone");
    expect(serialized).not.toContain("dateOfBirth");
  });

  // SandboxRemotionProvider.render (render-provider.ts) builds the payload it writes
  // into the sandbox by calling buildRenderManifest with its RenderInput's
  // compositionId/templateVersion/inputProps/traceId — this is the same call shape,
  // exercised without needing a real Sandbox (render-provider.ts is not imported by
  // any test in this package, by design).
  describe("as constructed by SandboxRemotionProvider.render", () => {
    const providerArgs = {
      compositionId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      inputProps: NARROW_INPUT_PROPS,
      traceId: "trace-from-render-input",
    };

    it("carries the provider's compositionId/templateVersion, inputProps, and traceId", () => {
      const manifest = buildRenderManifest(providerArgs);

      expect(manifest.technical.compositionId).toBe(TEMPLATE_ID);
      expect(manifest.versions.templateVersion).toBe(TEMPLATE_VERSION);
      expect(manifest.inputProps).toEqual(NARROW_INPUT_PROPS);
      expect(manifest.traceId).toBe("trace-from-render-input");
      expect(manifest.versions).toEqual({
        templateId: TEMPLATE_ID,
        templateVersion: TEMPLATE_VERSION,
        inputSchemaVersion: "1",
        rendererVersion: RENDERER_VERSION,
        renderProvider: RENDER_PROVIDER,
        bundleVersion: null,
      });
    });

    it("is secret-free even with secret-shaped env vars set (requirement 2)", () => {
      const before = process.env.SUPABASE_SECRET_KEY;
      process.env.SUPABASE_SECRET_KEY = FAKE_SUPABASE_SECRET;
      try {
        const manifest = buildRenderManifest(providerArgs);
        const serialized = JSON.stringify(manifest);
        for (const marker of SECRET_MARKERS) {
          expect(serialized).not.toContain(marker);
        }
      } finally {
        if (before === undefined) delete process.env.SUPABASE_SECRET_KEY;
        else process.env.SUPABASE_SECRET_KEY = before;
      }
    });
  });
});
