import { describe, it, expect, vi } from "vitest";

// staticFile() is Remotion-runtime-only; stub it so this stays a fast unit test and we
// can assert exactly WHEN it is applied (the whole point of the fix).
vi.mock("remotion", () => ({ staticFile: (p: string) => `STATIC:${p}` }));

import { resolvePhotoSrc } from "@/remotion/resolve";

describe("resolvePhotoSrc", () => {
  it("resolves a bundle-relative staged ref through staticFile()", () => {
    // render-provider stages source photos into the bundle publicDir and rewrites
    // inputProps to bare refs like "asset-0.jpg"; Remotion only serves those via
    // staticFile(). A bare src 404s at the server root (the RENDER_FAILED / EncodingError).
    expect(resolvePhotoSrc("asset-0.jpg")).toBe("STATIC:asset-0.jpg");
    expect(resolvePhotoSrc("asset-12.png")).toBe("STATIC:asset-12.png");
  });

  it("passes absolute URLs through untouched (Studio defaultProps, real remote/data srcs)", () => {
    for (const u of [
      "https://placehold.co/1920x1080",
      "http://example.com/y.jpg",
      "data:image/png;base64,AAAA",
      "blob:https://x/abc",
      "//cdn.example.com/x.jpg",
    ]) {
      expect(resolvePhotoSrc(u), `${u} must not be staticFile-wrapped`).toBe(u);
    }
  });
});
