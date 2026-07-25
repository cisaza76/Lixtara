import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { downscaleImageToFit } from "@/lib/video-engine/image-downscale";

// Solid-color test images (no real photos needed) — enough to exercise the resize contract.
async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 90, g: 110, b: 130 } } })
    .jpeg()
    .toBuffer();
}

describe("downscaleImageToFit — shrink oversized source photos to the render frame", () => {
  it("fits an oversized 4:3 photo inside 1920x1080, preserving aspect ratio", async () => {
    const out = await downscaleImageToFit(await jpeg(4000, 3000), { maxWidth: 1920, maxHeight: 1080 });
    const m = await sharp(out).metadata();
    expect(m.width).toBeLessThanOrEqual(1920);
    expect(m.height).toBeLessThanOrEqual(1080);
    expect(Math.abs((m.width as number) / (m.height as number) - 4 / 3)).toBeLessThan(0.02);
    expect(m.height).toBe(1080); // 4:3 into 1920x1080 is height-bound
  });

  it("does not enlarge an image already within the frame", async () => {
    const out = await downscaleImageToFit(await jpeg(800, 600), { maxWidth: 1920, maxHeight: 1080 });
    const m = await sharp(out).metadata();
    expect(m.width).toBe(800);
    expect(m.height).toBe(600);
  });

  it("returns a valid decodable image", async () => {
    const out = await downscaleImageToFit(await jpeg(2500, 2500), { maxWidth: 1920, maxHeight: 1080 });
    const m = await sharp(out).metadata();
    expect(m.format).toBe("jpeg");
    expect(m.width).toBeLessThanOrEqual(1920);
    expect(m.height).toBeLessThanOrEqual(1080);
  });
});
