import { staticFile } from "remotion";

// A source photo reaches the composition either as an absolute URL — Studio/defaultProps
// use https://placehold.co, and a real https/data/blob src is equally valid — OR, in the
// render pipeline, as a bundle-relative ref like "asset-0.jpg" that render-provider staged
// into the bundle's publicDir and rewrote inputProps to. Remotion serves staged public
// assets ONLY through staticFile(): a bare relative <Img src> resolves to the server root
// ("/asset-0.jpg"), 404s, and Chrome reports "EncodingError: The source image cannot be
// decoded" — the RENDER_FAILED seen in-sandbox. staticFile() would corrupt an absolute URL,
// so pass those through untouched. Same defect class as the static-fonts loadFont() fix.
const ABSOLUTE_SRC = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i; // scheme: (https:, data:, blob:, file:) or protocol-relative //

export function resolvePhotoSrc(url: string): string {
  return ABSOLUTE_SRC.test(url) ? url : staticFile(url);
}
