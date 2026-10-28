// Decisión del 28-oct: Lixtara representa al vendedor. Ningún texto del sitio (páginas,
// listados, correos, Loui) promete acompañar, representar o negociar por el comprador; donde
// se explica la relación, va el texto fijo de src/config/buyer-relationship.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUYER_SELLER_SIDE_LINE } from "@/config/buyer-relationship";
import { t } from "@/lib/i18n";
import { LOUI_SYSTEM_PROMPT } from "@/lib/loui-prompt";
import { termsFaq } from "@/config/legal-terms";

const FORBIDDEN = [
  // EN
  "search for homes with you", "negotiate your offer", "stay with you until closing", "stays with you until closing",
  "mediates", "We search with you", "supports you through the negotiation", "We stay with you", "Guidance from a licensed broker through closing",
  "acquisition support", "the broker can help you", "accompanied by Lixtara", "team by your side",
  // ES
  "equipo a tu lado", "buscan viviendas contigo", "negocian tu oferta", "te acompañan hasta el cierre", "te acompaña hasta el cierre",
  "media desde acá", "Buscamos contigo", "te acompaña en la negociación", "Te acompañamos", "la broker te acompaña",
  "apoyo en adquisiciones", "negocia tu oferta",
];

const SOURCES = ["src/lib/i18n.ts", "src/lib/email.ts", "src/lib/loui-prompt.ts", "src/config/legal-terms.ts", "src/components/showing-request-form.tsx"];

describe("sin promesas al comprador", () => {
  it("ninguna fuente de textos del sitio tiene una promesa de acompañamiento o representación", () => {
    const hits: string[] = [];
    for (const f of SOURCES) {
      const text = readFileSync(f, "utf8");
      for (const p of FORBIDDEN) if (text.includes(p)) hits.push(`${f}: "${p}"`);
    }
    expect(hits).toEqual([]);
  });

  it("donde se explica la relación con el comprador va el texto fijo, en EN y ES", () => {
    for (const lang of ["en", "es"] as const) {
      expect(t(lang).buyerServices.body).toBe(BUYER_SELLER_SIDE_LINE[lang]);
      expect(t(lang).aboutPage.buyers).toBe(BUYER_SELLER_SIDE_LINE[lang]);
      expect(LOUI_SYSTEM_PROMPT).toContain(BUYER_SELLER_SIDE_LINE[lang]);
      expect(JSON.stringify(termsFaq(lang))).not.toMatch(/te acompaña|can help you as soon/);
    }
    const email = readFileSync("src/lib/email.ts", "utf8");
    expect(email).toContain("BUYER_SELLER_SIDE_LINE.es");
    expect(email).toContain("BUYER_SELLER_SIDE_LINE.en");
    expect(readFileSync("src/components/showing-request-form.tsx", "utf8")).toContain("buyerSellerSideLine(lang)");
  });

  it("el texto fijo es el aprobado", () => {
    expect(BUYER_SELLER_SIDE_LINE.es).toBe(
      "Lixtara representa al vendedor. Si usted no tiene agente, podemos mostrarle la propiedad y recibir su oferta, pero no lo representamos: no le daremos asesoría para negociar contra el vendedor. Le recomendamos consultar a su propio agente o abogado.",
    );
    expect(BUYER_SELLER_SIDE_LINE.en).toBe(
      "Lixtara represents the seller. If you do not have an agent, we can show you the property and receive your offer, but we do not represent you and will not advise you in negotiating against the seller. We recommend consulting your own agent or attorney.",
    );
  });
});
