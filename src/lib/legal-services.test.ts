// Lixtara no vende, cobra ni incluye servicios legales (Florida Bar 4-5.4 y 4-5.5), y no
// promete acceso a propiedades antes del MLS (Clear Cooperation). Decisión del owner 2026-10-16.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { t } from "@/lib/i18n";
import { LOUI_SYSTEM_PROMPT } from "@/lib/loui-prompt";
import {
  conciergeLegalBullet,
  legalFaqAnswer,
  legalPartner,
  legalPartnerLink,
  legalReferralBullet,
  legalServicesDisclosure,
} from "@/config/legalPartner";
import { LOUI_LEGAL_CASES } from "@/lib/loui-legal-cases";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const dict = (lang: "en" | "es") => JSON.stringify(t(lang));

const FORBIDDEN = [
  "Attorney: $",
  "attorney consultations included",
  "Unlimited Attorney",
  "abogado incluido",
  "consultas con abogado incluidas",
  "consultas legales ilimitadas",
  "before the MLS",
  "antes del MLS",
  "48 hours before",
  "48 horas antes",
];

describe("frases prohibidas: locales, pricing-tiers.ts y Loui", () => {
  const surfaces: Record<string, string> = {
    "i18n en": dict("en"),
    "i18n es": dict("es"),
    "pricing-tiers.ts": read("src/lib/pricing-tiers.ts"),
    "Loui (system prompt)": LOUI_SYSTEM_PROMPT,
  };
  for (const [name, text] of Object.entries(surfaces)) {
    it.each(FORBIDDEN)(`${name} no dice «%s»`, (phrase) => {
      expect(text.toLowerCase()).not.toContain(phrase.toLowerCase());
    });
    it(`${name} no muestra ninguna tarifa de abogado`, () => {
      expect(text).not.toMatch(/\$450|450\s*\/\s*h/i);
    });
  }
});

describe("planes: referido a un abogado independiente (sin tarifas)", () => {
  it("configuración por defecto: sin firma aprobada, sin enlace, sin paquete", () => {
    expect(legalPartner.enabled).toBe(false);
    expect(legalPartner.packageEnabled).toBe(false);
    expect(legalPartnerLink()).toBeNull();
  });

  it("Essentials y Pro: dos bullets con el texto aprobado (EN/ES)", () => {
    for (const tier of ["essentials", "pro"] as const) {
      expect(t("en").pricing.tiers[tier].features).toContain("Realtor consultation: $150/hr (pay per use)");
      expect(t("en").pricing.tiers[tier].features).toContain(
        "Need a lawyer? We'll refer you to an independent Florida real estate attorney. You hire and pay the law firm directly.*",
      );
      expect(t("es").pricing.tiers[tier].features).toContain("Consulta con un Realtor: $150/hora (pago por uso)");
      expect(t("es").pricing.tiers[tier].features).toContain(
        "¿Necesitas abogado? Te referimos a un abogado inmobiliario independiente en Florida. Tú lo contratas y le pagas directamente a la firma.*",
      );
    }
  });

  it("Concierge: sin abogado incluido; referido mientras no haya paquete; Realtor ilimitado se mantiene", () => {
    expect(t("en").pricing.tiers.concierge.features).toContain(legalReferralBullet("en"));
    expect(t("es").pricing.tiers.concierge.features).toContain(legalReferralBullet("es"));
    expect(conciergeLegalBullet("en")).toBe(legalReferralBullet("en"));
    expect(t("en").pricing.tiers.concierge.features).toContain("Unlimited Realtor consultations included");
    expect(t("es").pricing.tiers.concierge.features).toContain("Consultas ilimitadas con Realtor incluidas");
  });

  it("los mismos bullets en EN y ES (paridad de arreglos modificados)", () => {
    for (const tier of ["essentials", "pro", "concierge"] as const) {
      expect(t("es").pricing.tiers[tier].features.length, tier).toBe(t("en").pricing.tiers[tier].features.length);
      expect(t("es").pricing.tiers[tier].notIncluded.length, tier).toBe(t("en").pricing.tiers[tier].notIncluded.length);
    }
    expect(t("es").faq.items.length).toBe(t("en").faq.items.length);
    for (const tier of ["silver", "gold", "platinum"] as const) {
      expect(t("es").investor.tiers[tier].bullets.length, tier).toBe(t("en").investor.tiers[tier].bullets.length);
    }
  });

  it("divulgación con el texto aprobado, en tú y sin tarifas", () => {
    expect(legalServicesDisclosure("en")).toBe(
      "Lixtara LLC is a licensed real estate brokerage, not a law firm, and does not provide legal advice. Legal services are provided solely by an independent Florida law firm, which is not owned or controlled by Lixtara. You sign your own agreement with the firm and pay it directly. Lixtara receives no payment for referring you, and you are free to choose any attorney.",
    );
    expect(legalServicesDisclosure("es")).toBe(
      "Lixtara LLC es una brokerage inmobiliaria con licencia, no una firma de abogados, y no presta asesoría legal. Los servicios legales los presta exclusivamente una firma de abogados independiente de Florida, que no es propiedad de Lixtara ni está bajo su control. Firmas tu propio contrato con la firma y le pagas directamente. Lixtara no recibe ningún pago por referirte y puedes elegir libremente a cualquier abogado.",
    );
    for (const s of [legalServicesDisclosure("es"), legalReferralBullet("es"), legalFaqAnswer("es")]) {
      expect(s).not.toMatch(/\busted\b/i);
    }
  });

  it("la FAQ responde que ningún plan incluye abogado (EN/ES)", () => {
    expect(t("en").faq.items.some((i) => i.a === legalFaqAnswer("en"))).toBe(true);
    expect(t("es").faq.items.some((i) => i.a === legalFaqAnswer("es"))).toBe(true);
  });

  it.each([
    "src/app/[lang]/page.tsx",
    "src/app/[lang]/listing/new/page.tsx",
    "src/app/[lang]/consultations/page.tsx",
    "src/app/[lang]/services/page.tsx",
    "src/app/[lang]/terms/page.tsx",
  ])("%s muestra la divulgación", (file) => {
    expect(read(file)).toContain("<LegalServicesDisclosure");
  });
});

describe("ningún flujo de Lixtara cobra servicios legales", () => {
  it("Stripe: sin productos ni metadata de abogado", () => {
    const stripe = read("src/lib/stripe.ts");
    expect(stripe).not.toMatch(/attorney|abogad/i);
  });
  it("el webhook de Stripe no acredita horas de abogado (ni de sesiones viejas)", () => {
    const webhook = read("src/app/api/webhooks/stripe/route.ts");
    expect(webhook).not.toMatch(/attorney_hours|attorneyHours|service_type: "attorney"/);
    expect(webhook).toContain('service_type: "realtor"');
  });
  it("la página de consultas no vende horas de abogado", () => {
    const page = read("src/app/[lang]/consultations/page.tsx");
    expect(page).not.toMatch(/attorney_1|best_value|ATTORNEY_HOURLY/);
  });
});

describe("Investor Club y acceso anticipado", () => {
  it("sin acceso antes del MLS, off-market, pre-listing ni prioridad (EN/ES)", () => {
    for (const lang of ["en", "es"] as const) {
      const inv = JSON.stringify(t(lang).investor);
      expect(inv, lang).not.toMatch(/48|off-market|fuera del mercado|pre-listing|antes de su publicaci|early access|acceso anticipado|priorit|prioridad/i);
    }
  });
});

describe("Ask Loui: casos legales y de acceso anticipado", () => {
  it("el prompt prohíbe asesoría legal, abogado incluido, tarifas y acceso antes del MLS", () => {
    expect(LOUI_SYSTEM_PROMPT).toContain("Lixtara is a real estate brokerage, NOT a law firm");
    expect(LOUI_SYSTEM_PROMPT).toContain("never interpret the legal meaning, scope or validity of a clause");
    expect(LOUI_SYSTEM_PROMPT).toContain("never quote any attorney fee or rate");
    expect(LOUI_SYSTEM_PROMPT).toContain("Never say or imply that any Lixtara plan includes a lawyer");
    expect(LOUI_SYSTEM_PROMPT).toContain("Never promise or suggest access to listings before they are on the MLS");
    expect(LOUI_SYSTEM_PROMPT).toContain("the client hires and pays the law firm directly");
    expect(LOUI_SYSTEM_PROMPT).not.toMatch(/consultation_attorney|PhD|holding both a Realtor and Broker license/);
  });

  it("Loui no puede agendar una consulta legal", () => {
    const route = read("src/app/api/loui/route.ts");
    const types = route.slice(route.indexOf("const SCHEDULE_TYPES"), route.indexOf("] as const"));
    expect(types).not.toContain('"consultation_attorney"');
  });

  it("los 6 casos de prueba están definidos en EN y ES", () => {
    expect(LOUI_LEGAL_CASES.map((c) => c.question)).toEqual([
      "Does Concierge include a lawyer?",
      "¿Me revisan el contrato con un abogado?",
      "Is this clause legal?",
      "¿Cuánto cobra el abogado?",
      "Can I see listings before they hit the MLS?",
      "¿Puedo ver propiedades antes que salgan al MLS?",
    ]);
  });
});
