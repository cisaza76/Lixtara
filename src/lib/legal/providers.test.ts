import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PRIVACY_PROVIDERS } from "./providers";
import { privacyDoc } from "./privacy";
import { fillLegalDoc } from "./config";

const root = resolve(__dirname, "../../..");

/** Todo el código de la app (sin pruebas ni los textos legales, que nombran a los proveedores). */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.includes(join("src", "lib", "legal"))) {
      out.push(p);
    }
  }
  return out;
}
const source = sourceFiles(join(root, "src"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n")
  .toLowerCase();

// Marcadores de servicios de terceros (SDK, host o módulo) → proveedor que debe estar en la
// política. Si el código empieza a usar un servicio nuevo (p. ej. OpenAI, Twilio, Replicate),
// la prueba falla hasta que se agregue a PRIVACY_PROVIDERS (y, con él, a la política).
const KNOWN_MARKERS: Record<string, string> = {
  "@supabase/": "supabase",
  "@vercel/sandbox": "vercel",
  "@ai-sdk/anthropic": "anthropic",
  "@google/genai": "google-gemini",
  "maps.googleapis.com": "google-maps",
  "googletagmanager.com": "google-analytics",
  "google-analytics.com/mp": "google-analytics",
  "data-clarity-mask": "microsoft-clarity",
  'from "stripe"': "stripe",
  "docusign": "docusign",
  'from "resend"': "resend",
  "@upstash/": "upstash",
  "challenges.cloudflare.com": "cloudflare",
  "@sentry/": "sentry",
  "rentcast": "rentcast",
  "lumalabs": "luma",
  "api.mapbox.com": "mapbox",
  "api.instantly.ai": "instantly",
  "bridgedataoutput": "mls",
  "miamidadepa": "miami-dade",
  "posthog-js": "posthog",
  // Servicios que hoy no se usan: si aparecen, hay que declararlos.
  "api.openai.com": "openai",
  'from "openai"': "openai",
  "api.twilio.com": "twilio",
  'from "twilio"': "twilio",
  "api.replicate.com": "replicate",
  "connect.facebook.net": "meta",
  "graph.facebook.com": "meta",
  "_fbp": "meta",
  "_gcl_aw": "google-ads",
  "static.hotjar.com": "hotjar",
  "cdn.segment.com": "segment",
};

const ids = new Set(PRIVACY_PROVIDERS.map((p) => p.id));

describe("proveedores de la Política de Privacidad", () => {
  it("cada servicio de terceros que usa el código está declarado", () => {
    const missing = Object.entries(KNOWN_MARKERS)
      .filter(([marker, id]) => source.includes(marker.toLowerCase()) && !ids.has(id))
      .map(([marker, id]) => `${id} (${marker})`);
    expect(missing, "agregar a src/lib/legal/providers.ts").toEqual([]);
  });

  it("el inventario no pasa en vacío: los proveedores principales aparecen en el código", () => {
    for (const m of ["@supabase/", 'from "stripe"', "docusign", "@ai-sdk/anthropic", "maps.googleapis.com", "@sentry/"]) {
      expect(source.includes(m.toLowerCase()), m).toBe(true);
    }
  });

  it("cada proveedor aparece en la política EN y ES, con el enlace a su política si está comprobado", () => {
    for (const lang of ["en", "es"] as const) {
      const doc = JSON.stringify(fillLegalDoc(privacyDoc[lang]));
      for (const p of PRIVACY_PROVIDERS) {
        expect(doc, `${lang}: ${p.name}`).toContain(p.name);
        if (p.policyUrl) {
          expect(p.policyUrl, p.id).toMatch(/^https:\/\/\S+$/);
          expect(doc, `${lang}: ${p.id} url`).toContain(p.policyUrl);
        }
      }
    }
    // Sin enlace solo los que no se pudieron comprobar (2026-10-18).
    expect(PRIVACY_PROVIDERS.filter((p) => !p.policyUrl).map((p) => p.id)).toEqual(["mls", "miami-dade"]);
  });

  it("los ids son únicos", () => {
    expect(ids.size).toBe(PRIVACY_PROVIDERS.length);
  });
});
