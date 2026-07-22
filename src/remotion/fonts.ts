// Font families for the `ListingVideo` composition. The Lixtara faces (Playfair Display
// 500/600/500-italic, Inter 600) are installed as SYSTEM fonts in the sandbox base
// artifact (/usr/share/fonts/lixtara — see docs/superpowers/runbooks/bake-sandbox-base.mjs),
// so the render resolves them at OS level with ZERO runtime loading: no loadFont(), no
// @remotion/fonts, no data URIs, no font delayRender. That removes the per-Chrome-tab
// FontFace load that starved a real 10-photo render past its 28s delayRender timeout
// (proven root cause — F1 isolation experiment). The generic fallbacks are a safety net;
// the artifact's fail-closed font gates guarantee the primary faces are present.
//
// The vendored public/fonts/*.woff2 remain the reproducible SOURCE the bake converts to
// TTF and installs — they are no longer a runtime asset.
export const SERIF = '"Playfair Display", Georgia, serif';
export const SANS = '"Inter", Arial, sans-serif';
