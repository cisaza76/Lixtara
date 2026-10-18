import { describe, it, expect, vi } from "vitest";
import { GLOSSARY, glossaryViolations, term } from "@/config/glossary";
import { dictionaryTexts, legalTermTexts, type Lang } from "@/lib/site-texts.test-helpers";
import { LOUI_SYSTEM_PROMPT } from "@/lib/loui-prompt";
import { termsDoc } from "@/lib/legal/terms";

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

async function emailTexts(lang: Lang) {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  h.calls.length = 0;
  await sendPaymentReceipt({ to: "s@example.com", lang, amount: 495, tier: "pro", propertyAddress: "1 A St", dashboardUrl: "https://x/d" });
  await sendAgreementSigned({ to: "s@example.com", lang, propertyAddress: "1 A St", paymentUrl: "https://x/p" });
  await sendListingApproved({ to: "s@example.com", lang, propertyAddress: "1 A St", listingUrl: "https://x/l" });
  return h.calls.map((c, i) => ({ where: `email[${i}]`, text: `${c.subject} ${c.html.replace(/<[^>]+>/g, " ")} ${c.text}` }));
}

/** Términos del Servicio (encabezados, párrafos y bullets). */
function termsTexts(lang: Lang) {
  const doc = termsDoc[lang];
  const sections = doc.sections.flatMap((sec) => [sec, ...(sec.sub ?? [])]);
  return [
    ...doc.intro.map((text, i) => ({ where: `terms.intro[${i}]`, text })),
    ...sections.flatMap((sec) =>
      [sec.heading, ...sec.body, ...(sec.bullets ?? [])].map((text) => ({ where: `terms.${sec.heading}`, text })),
    ),
  ];
}

describe("glosario EN/ES", () => {
  it("cada término tiene forma aprobada en los dos idiomas", () => {
    for (const [k, v] of Object.entries(GLOSSARY)) {
      expect(v.en, k).toBeTruthy();
      expect(v.es, k).toBeTruthy();
    }
    expect(term("broker", "es")).toBe("broker");
    expect(term("buyerAgentComp", "es")).toBe("compensación al agente del comprador");
  });

  it("detecta variantes no aprobadas", () => {
    expect(glossaryViolations("la comisión del comprador", "es").map((v) => v.key)).toContain("buyerAgentComp");
    expect(glossaryViolations("honorarios de Lixtara", "es").map((v) => v.key)).toContain("lixtaraCommission");
    expect(glossaryViolations("habla con el corredor", "es").map((v) => v.key)).toContain("broker");
    expect(glossaryViolations("un corredor hipotecario", "es")).toEqual([]);
    expect(term("theBroker", "es")).toBe("la broker");
    for (const t of ["habla con el broker", "revisión del broker", "pregúntale al broker", "un broker dedicado"]) {
      expect(glossaryViolations(t, "es").map((v) => v.key), t).toContain("theBroker");
    }
    for (const t of ["habla con la broker", "revisión de la broker", "la broker dedicada", "un broker licenciado", "tu broker"]) {
      expect(glossaryViolations(t, "es"), t).toEqual([]);
    }
    expect(glossaryViolations("the buyer-agent commission", "en").map((v) => v.key)).toContain("buyerAgentComp");
  });

  it.each(["en", "es"] as const)("%s: diccionario, términos legales, Términos del Servicio, correos y Loui usan solo términos aprobados", async (lang) => {
    const texts = [...dictionaryTexts(lang), ...legalTermTexts(lang), ...(await emailTexts(lang)), ...termsTexts(lang)];
    if (lang === "en") texts.push({ where: "loui-prompt", text: LOUI_SYSTEM_PROMPT });
    expect(texts.length).toBeGreaterThan(800); // el recorrido no pasa en vacío
    const found = texts.flatMap(({ where, text }) => glossaryViolations(text, lang).map((v) => `${where}: ${v.match}`));
    expect(found).toEqual([]);
  });
});
