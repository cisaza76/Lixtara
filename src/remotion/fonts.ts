// Self-contained local fonts for the `ListingVideo` composition. The vendored
// `.woff2` files under `public/fonts/` (SIL Open Font License — see
// public/fonts/LICENSE.txt) are base64-embedded as data URIs in `fonts-data.ts`
// (regenerate with `node scripts/embed-fonts.mjs`) and loaded via `@remotion/fonts`'
// `loadFont()`.
//
// Embedded rather than fetched over HTTP on purpose: `loadFont()` builds a
// `new FontFace(family, "url('<url>') format('woff2')")` and holds the render in a
// `delayRender` until the font resolves. A data-URI source resolves with NO network,
// so a real multi-photo render can't blow the delayRender timeout the way an in-sandbox
// HTTP font fetch did under load. (Also deliberately NOT `@remotion/google-fonts`,
// which fetches from `fonts.gstatic.com` and breaks in network-isolated render envs.)
// `format: "woff2"` is passed explicitly because `getFontFormat()` can't infer it from
// a data URI. Only the weights ListingVideo.tsx uses are vendored.
import { loadFont } from "@remotion/fonts";
import { PLAYFAIR_500, PLAYFAIR_600, PLAYFAIR_500_ITALIC, INTER_600 } from "./fonts-data";

export const SERIF = "Lixtara Playfair Display";
export const SANS = "Lixtara Inter";

const fontFiles = [
  { family: SERIF, url: PLAYFAIR_500, weight: "500", style: "normal" as const, format: "woff2" as const },
  { family: SERIF, url: PLAYFAIR_600, weight: "600", style: "normal" as const, format: "woff2" as const },
  { family: SERIF, url: PLAYFAIR_500_ITALIC, weight: "500", style: "italic" as const, format: "woff2" as const },
  { family: SANS, url: INTER_600, weight: "600", style: "normal" as const, format: "woff2" as const },
];

// Kicks off all `loadFont()` calls (and their internal `delayRender`
// handles) as soon as this module is imported. Consumers don't need to
// await this for the render to be held correctly, but it's exported so
// tests / tooling can await font readiness explicitly if needed.
export const fontsReady: Promise<unknown> = Promise.all(fontFiles.map((font) => loadFont(font)));
