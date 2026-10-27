import { describe, it, expect } from "vitest";
import { nextStepKind, type NextStepInput } from "./dashboard-next-step";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { t } from "./i18n";
import { PUBLICATION_BUSINESS_DAYS, publicationTimeline } from "@/config/legal-terms";

const paidPending: NextStepInput = {
  mlsStatus: "pending_approval",
  paymentDone: true,
  agreementDone: true,
  stagedCount: 0,
  videoStatus: "none",
  offersCount: 0,
};

describe("nextStepKind", () => {
  it("pagado y firmado, en revisión de la broker: qué sigue, no el staging", () => {
    expect(nextStepKind(paidPending)).toBe("awaiting_broker");
  });

  it("mantiene el orden previo fuera de la revisión", () => {
    expect(nextStepKind({ ...paidPending, mlsStatus: "draft" })).toBe("complete");
    expect(nextStepKind({ ...paidPending, paymentDone: false })).toBe("pay");
    expect(nextStepKind({ ...paidPending, agreementDone: false })).toBe("agreement");
    expect(nextStepKind({ ...paidPending, mlsStatus: "active" })).toBe("staging");
    expect(nextStepKind({ ...paidPending, mlsStatus: "active", stagedCount: 2 })).toBe("video");
    expect(
      nextStepKind({ ...paidPending, mlsStatus: "active", stagedCount: 2, videoStatus: "ready", offersCount: 1 }),
    ).toBe("offers");
    expect(nextStepKind({ ...paidPending, mlsStatus: "active", stagedCount: 2, videoStatus: "ready" })).toBe(
      "optimized",
    );
  });
});

describe("textos de 'qué sigue'", () => {
  it("tres pasos en EN y ES, sin plazos ni portales prometidos", () => {
    for (const lang of ["en", "es"] as const) {
      const cc = t(lang).dashboard.command;
      expect(cc.whatsNextSteps).toHaveLength(3);
      const text = [cc.whatsNextLabel, ...cc.whatsNextSteps, cc.whatsNextSecondary].join(" ");
      expect(text, lang).not.toMatch(/zillow|realtor\.com|redfin|trulia/i);
      expect(text, lang).not.toMatch(/\d+\s*(h|hours?|horas?|days?|d[ií]as?)\b/i);
      expect(text, lang).not.toMatch(/email|correo/i);
    }
  });

  it("el plazo sale de legal-terms.ts (2 días hábiles), no de un texto propio", () => {
    const src = readFileSync(resolve(__dirname, "../app/[lang]/dashboard/page.tsx"), "utf8");
    expect(src).toContain("deadline: publicationTimeline.text[lang as Locale].sentence");
    expect(publicationTimeline.text.en.sentence).toContain(`within ${PUBLICATION_BUSINESS_DAYS} business days`);
    expect(publicationTimeline.text.es.sentence).toContain(`dentro de ${PUBLICATION_BUSINESS_DAYS} días hábiles`);
  });

  it("la confirmación de firma no promete publicar con el pago", () => {
    for (const lang of ["en", "es"] as const) {
      const body = t(lang).listingForm.step7.signedBody;
      expect(body, lang).toMatch(/broker/);
      expect(body, lang).not.toMatch(/to publish your listing|para publicar tu listado/i);
    }
  });
});
