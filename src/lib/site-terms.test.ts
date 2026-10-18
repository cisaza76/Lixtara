import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dictionaryTexts, legalTermTexts, sentences, type Lang, type SiteText } from "@/lib/site-texts.test-helpers";
import { LOUI_SYSTEM_PROMPT } from "@/lib/loui-prompt";
import { dictionaries } from "@/lib/i18n";
import { LOUI_TERMS_CASES } from "@/lib/loui-terms-cases";
import {
  PUBLICATION_BUSINESS_DAYS,
  buyerAgentComp,
  publicationTimeline,
  refundPolicy,
  termsFaq,
} from "@/config/legal-terms";

// Ningún texto del sitio contradice src/config/legal-terms.ts: ni otro plazo de publicación,
// ni otro reembolso, ni la compensación al agente del comprador incluida en la comisión de
// Lixtara o publicada en el MLS, ni 0% bloqueado.

const h = vi.hoisted(() => ({ calls: [] as Array<{ html: string; text: string; subject: string }> }));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (arg: { html: string; text: string; subject: string }) => {
        h.calls.push(arg);
        return { data: { id: "email-1" }, error: null };
      },
    };
  },
}));

import { sendAgreementSigned, sendListingApproved, sendPaymentReceipt } from "@/lib/email";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

async function emails(lang: Lang) {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  h.calls.length = 0;
  await sendPaymentReceipt({ to: "s@example.com", lang, amount: 495, tier: "pro", propertyAddress: "1 A St", dashboardUrl: "https://x/d" });
  await sendAgreementSigned({ to: "s@example.com", lang, propertyAddress: "1 A St", paymentUrl: "https://x/p" });
  await sendListingApproved({ to: "s@example.com", lang, propertyAddress: "1 A St", listingUrl: "https://x/l" });
  const names = ["receipt", "agreementSigned", "approved"];
  return h.calls.map((c, i) => ({ where: `email.${names[i]}`, text: `${c.subject}. ${c.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")} ${c.text}` }));
}

async function allTexts(lang: Lang): Promise<SiteText[]> {
  const out = [...dictionaryTexts(lang), ...legalTermTexts(lang), ...(await emails(lang))];
  if (lang === "en") out.push({ where: "loui-prompt", text: LOUI_SYSTEM_PROMPT });
  return out;
}

// Cualquier oración que hable del agente del comprador (la vieja FAQ decía "se publica con tu
// listado en el MLS" sin nombrar la compensación).
const COMP = /buyer'?s agent|buyer-agent|buyers' agents|agentes? del comprador|compensaci[oó]n/i;

// Único plazo en días hábiles que no es la publicación: la baja por correo de /owners ("we'll
// remove you within 10 business days" / "te quitamos en un máximo de 10 días hábiles"). Su
// texto exacto lo fija site-claims.test.ts.
const UNSUBSCRIBE = /\b(remove you|te quitamos)\b/i;

describe.each(["en", "es"] as const)("%s: el sitio no contradice legal-terms.ts", (lang) => {
  it("plazo de publicación: nunca horas, ni 'tras la firma', ni otro número de días hábiles", async () => {
    const bad: string[] = [];
    for (const { where, text } of await allTexts(lang)) {
      for (const s of sentences(text)) {
        // El prompt de Loui nombra los plazos prohibidos para prohibirlos ("Never promise …").
        if (where === "loui-prompt" && /^Never\b/.test(s)) continue;
        const aboutPublishing = /\b(MLS|publish|published|publica|publicad|live|go live)\b/i.test(s);
        if (aboutPublishing && /\b(24|48|72) ?(h|hrs?|hours|horas)\b|24\/48/i.test(s)) bad.push(`${where}: ${s}`);
        if (/\b\d+ (days|días) (after|tras|despu[eé]s de) (signing|la firma)/i.test(s)) bad.push(`${where}: ${s}`);
        for (const m of UNSUBSCRIBE.test(s) ? [] : s.matchAll(/\b(\d+) (business days|días hábiles)\b/gi)) {
          if (Number(m[1]) !== PUBLICATION_BUSINESS_DAYS) bad.push(`${where}: ${s}`);
        }
        if (/\bpriority (MLS )?publication|publicaci[oó]n prioritaria/i.test(s)) bad.push(`${where}: ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("todo plazo en días hábiles lleva su disparador (acuerdo firmado + material completo)", async () => {
    const trigger = lang === "en" ? /agreement is signed/ : /acuerdo esté firmado/;
    for (const { where, text } of await allTexts(lang)) {
      for (const s of sentences(text)) {
        if (/business days|días hábiles/i.test(s) && !UNSUBSCRIBE.test(s)) expect(s, where).toMatch(trigger);
      }
    }
  });

  it("reembolso: cualquier mención es la política exacta (o una pregunta)", async () => {
    const policy = refundPolicy.text[lang];
    const bad: string[] = [];
    for (const { where, text } of await allTexts(lang)) {
      if (where === "loui-prompt") continue; // el prompt cita la política: se revisa abajo
      const mentions = /refund|non-?refundable|reembols|devolvemos el total|money back|devuelven el dinero/i;
      if (!mentions.test(text)) continue;
      if (text.includes(policy)) continue;
      if (/\?$/.test(text.trim())) continue;
      bad.push(`${where}: ${text.slice(0, 160)}`);
    }
    expect(bad).toEqual([]);
  });

  it("la compensación nunca se describe incluida en la comisión de Lixtara ni publicada en el MLS", async () => {
    const bad: string[] = [];
    for (const { where, text } of await allTexts(lang)) {
      for (const s of sentences(text)) {
        if (!COMP.test(s)) continue;
        if (/\b(included in|part of|incluida en|parte de) (the |la )?(Lixtara|comisi[oó]n de Lixtara)/i.test(s)) bad.push(`${where}: ${s}`);
        const saysPublished = /(publish|published|publica|publicad|shown|aparece)/i.test(s) && /\bMLS\b/.test(s);
        const negated = /\b(not|no|n't|never|nunca)\b|n't\b/i.test(s);
        if (saysPublished && !negated) bad.push(`${where}: ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("sin etiquetas de juicio de valor sobre el porcentaje", async () => {
    const bad = /Harder to get agents|Maximum exposure|Market standard|Recommended|Below market|Difícil|Máxima exposición|Estándar del mercado|Recomendado|Debajo del mercado/;
    const step6 = JSON.stringify(dictionaries[lang].listingForm.step6);
    expect(step6).not.toMatch(bad);
    expect(JSON.stringify(dictionaries[lang].savings)).not.toMatch(bad);
  });

  it("los planes y la FAQ leen las definiciones", () => {
    const d = dictionaries[lang];
    for (const tier of ["essentials", "pro", "concierge"] as const) {
      expect(d.pricing.tiers[tier].features, tier).toContain(publicationTimeline.text[lang].planBullet);
    }
    const faq = termsFaq(lang);
    for (const item of Object.values(faq)) expect(d.faq.items, item.q).toContainEqual(item);
    expect(faq.refund.a).toBe(refundPolicy.text[lang]);
  });

  it("los correos llevan el plazo y el reembolso de la configuración", async () => {
    const [receipt, signed, approved] = await emails(lang);
    expect(receipt.text).toContain(publicationTimeline.text[lang].sentence);
    expect(receipt.text).toContain(refundPolicy.text[lang]);
    expect(signed.text).toContain(publicationTimeline.text[lang].sentence);
    expect(approved.text).toContain(refundPolicy.text[lang]);
  });
});

describe("superficies que leen la configuración", () => {
  it("paso 6 y paso 8 usan los textos de legal-terms", () => {
    const wizard = read("src/app/[lang]/listing/new/page.tsx");
    for (const s of ["comp.stepTitle", "comp.stepBody", "comp.noticeOffer", "comp.noticeNoOffer", "comp.conciergeSuggested",
                     "publicationTimeline.text[lang].sentence", "refundPolicy.text[lang]"]) {
      expect(wizard, s).toContain(s);
    }
  });

  it("la ficha pública no muestra la oferta: remite al broker", () => {
    const page = read("src/app/[lang]/property/[id]/page.tsx");
    expect(page).not.toMatch(/buyer_agent_commission\}%/);
    expect(page).toContain("buyerAgentComp.text[lang].publicNote");
    expect(buyerAgentComp.text.es.publicNote).toMatch(/broker/);
  });

  it("Loui recibe las definiciones exactas", () => {
    for (const s of [buyerAgentComp.text.en.summary, refundPolicy.text.en, publicationTimeline.text.en.sentence]) {
      expect(LOUI_SYSTEM_PROMPT).toContain(s);
    }
    expect(LOUI_SYSTEM_PROMPT).not.toMatch(/priority publication within 48 hours/);
    expect(LOUI_SYSTEM_PROMPT).not.toContain("2,5%");
  });

  it("Loui no ofrece funciones del catálogo MLS (no están activas)", () => {
    const offers = LOUI_SYSTEM_PROMPT.split("\n").filter((l) => /search alerts?|saved search|alertas de búsqueda/i.test(l) && !/\bNOT active\b|\bno\b|\bnever\b/i.test(l));
    expect(offers).toEqual([]);
    expect(LOUI_SYSTEM_PROMPT).toMatch(/MLS catalog features are NOT active/);
    expect(LOUI_SYSTEM_PROMPT).not.toMatch(/buyers can (search listings|set up search alerts)/);
  });

  it("ninguna cifra de portales sin respaldo", async () => {
    for (const lang of ["en", "es"] as const) {
      for (const { where, text } of await allTexts(lang)) {
        expect(text, where).not.toMatch(/\d+\+? (other )?(sites|portals|websites)|m[aá]s de \d+ (sitios|portales)|\d+ (sitios|portales)/i);
      }
    }
  });

  it("casos de Loui: 0%, monto fijo, plazo, reembolso y alertas, en EN y ES", () => {
    expect(LOUI_TERMS_CASES).toHaveLength(10);
    expect(LOUI_TERMS_CASES.filter((c) => c.lang === "es")).toHaveLength(5);
    for (const c of LOUI_TERMS_CASES.filter((c) => c.lang === "es")) {
      expect(c.mustNot.map(String).join(" "), c.question).toContain("usted");
    }
  });
});
