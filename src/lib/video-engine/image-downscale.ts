import sharp from "sharp";

// Downscale a source photo so it fits within the render frame. Real listing photos are
// 2–5 MB each (phone-sized); a 1080p render doesn't need that resolution, and loading
// ~30 MB of images concurrently in the sandbox starved the per-image delayRender past
// its 28s timeout (RENDER_TIMEOUT). Fitting each photo to the frame drops it to a few
// hundred KB, so it loads/decodes fast.
//
// `.rotate()` with no args applies EXIF orientation to the pixels BEFORE resizing — sharp
// drops metadata on output, so without this a phone photo shot in portrait would render
// sideways. Aspect ratio is preserved (`fit: "inside"`) and small images are never
// enlarged (`withoutEnlargement`). The input format is kept (jpeg stays jpeg, png stays
// png) so the staged file's extension still matches its bytes.
export async function downscaleImageToFit(
  input: Buffer,
  opts: { maxWidth: number; maxHeight: number },
): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({ width: opts.maxWidth, height: opts.maxHeight, fit: "inside", withoutEnlargement: true })
    .toBuffer();
}
