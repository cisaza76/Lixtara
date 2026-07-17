// Self-contained local fonts for the `ListingVideo` composition. Vendored
// `.woff2` files under `public/fonts/` (SIL Open Font License — see
// public/fonts/LICENSE.txt), loaded via `@remotion/fonts`' `loadFont()`,
// which internally wraps the fetch in `delayRender`/`continueRender` so a
// render waits for the local font before capturing frames.
//
// Deliberately NOT `@remotion/google-fonts`: that package's `loadFont()`
// fetches `.woff2` from `fonts.gstatic.com` at render time, which breaks in
// network-isolated render environments (see Task 5 Vercel Sandbox). Only the
// weights actually used by `ListingVideo.tsx` are vendored — Playfair
// Display 500/600 normal + 500 italic, Inter 600.
import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export const SERIF = "Lixtara Playfair Display";
export const SANS = "Lixtara Inter";

const fontFiles = [
  { family: SERIF, url: staticFile("fonts/PlayfairDisplay-500.woff2"), weight: "500", style: "normal" as const },
  { family: SERIF, url: staticFile("fonts/PlayfairDisplay-600.woff2"), weight: "600", style: "normal" as const },
  {
    family: SERIF,
    url: staticFile("fonts/PlayfairDisplay-500Italic.woff2"),
    weight: "500",
    style: "italic" as const,
  },
  { family: SANS, url: staticFile("fonts/Inter-600.woff2"), weight: "600", style: "normal" as const },
];

// Kicks off all `loadFont()` calls (and their internal `delayRender`
// handles) as soon as this module is imported. Consumers don't need to
// await this for the render to be held correctly, but it's exported so
// tests / tooling can await font readiness explicitly if needed.
export const fontsReady: Promise<unknown> = Promise.all(fontFiles.map((font) => loadFont(font)));
