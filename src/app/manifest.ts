import type { MetadataRoute } from "next";

// Home-screen install (Android/Chrome). Icons: the italic "L" of the Lixtara
// wordmark (Playfair Display 500 Italic), ivory on ink. Source and build
// script: the glyph is converted to a vector path, so it renders the same
// everywhere without loading the font.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lixtara",
    short_name: "Lixtara",
    description: "Florida flat-fee brokerage. List on the MLS for less.",
    start_url: "/",
    display: "standalone",
    background_color: "#FDFBF5",
    theme_color: "#0F172A",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
