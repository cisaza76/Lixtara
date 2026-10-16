import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { t } from "@/lib/i18n";
import { sellerLeadIsTest } from "@/lib/listing-email-gate";
import { COOKIES_LAST_UPDATED, LEGAL_LAST_UPDATED } from "@/lib/legal/types";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const page = read("src/app/[lang]/listing/new/page.tsx");

describe("hallazgos de preview (paso 1, validación, cookies, seller_leads)", () => {
  it("ningún enlace del paso 1 manda a /sign-in sin idioma ni regreso completo", () => {
    expect(page).not.toContain("sign-in?next=/listing/new`}");
    expect(page.match(/step1SignInHref\(lang, sp\.suggested_tier\)/g)).toHaveLength(2);
    expect(page).toContain('sp.restore === "1"');
  });

  it("un intento fallido en /sign-in conserva next", () => {
    expect(read("src/app/[lang]/sign-in/page.tsx")).toMatch(/sign-in\?error=\$\{key\}\$\{keepNext\}/);
  });

  it.each(["saveStep1", "saveStep2", "saveStep3", "saveStep4", "nextFromStep5"])(
    "el formulario de %s es noValidate desde el HTML del servidor",
    (action) => {
      const at = page.indexOf(`action={${action}}`);
      expect(page.slice(at, at + 80)).toContain("noValidate");
    },
  );

  it("cada <AppFormValidation> recibe los textos por campo", () => {
    const uses = page.match(/<AppFormValidation[\s\S]*?\/>/g) ?? [];
    expect(uses).toHaveLength(5);
    for (const u of uses) {
      expect(u).toContain("labels={copy.validation}");
      expect(u).toContain("fieldMessages={copy.fieldErrors}");
    }
  });

  it("hay mensaje por campo para cada obligatorio, en EN y ES", () => {
    const names = [
      "street", "city", "zip", "email", "pricing_tier", "bedrooms", "bathrooms",
      "year_built", "sqft", "list_price", "photos_rights_confirmed",
    ];
    for (const lang of ["en", "es"] as const) {
      const f = t(lang).listingForm.fieldErrors as Record<string, string>;
      for (const n of names) expect(f[n], `${lang}.${n}`).toBeTruthy();
    }
    expect(t("es").listingForm.fieldErrors.street).toBe("Ingresa la dirección.");
    expect(t("es").listingForm.fieldErrors.list_price).toBe("Ingresa el precio de venta.");
    expect(t("es").listingForm.fieldErrors.photos_rights_confirmed).toBe(
      "Confirma que tienes los derechos de las fotos.",
    );
  });

  it("el componente pone el mensaje junto al campo, lleva el scroll y oculta los avisos anteriores", () => {
    const c = read("src/components/app-form-validation.tsx");
    expect(c).toContain("scrollIntoView");
    expect(c).toContain("focus({ preventScroll: true })");
    expect(c).toContain('querySelectorAll<HTMLElement>("[data-step-notice]")');
    expect(read("src/components/auth-shell.tsx")).toContain("data-step-notice");
    expect(page).toMatch(/data-step-notice\s+href=\{step1SignInHref/);
  });

  it("la política de cookies lleva la fecha del despliegue de #193; los demás documentos no cambian", () => {
    expect(COOKIES_LAST_UPDATED).toBe("2026-10-16");
    expect(LEGAL_LAST_UPDATED).toBe("2026-09-02");
    expect(read("src/app/[lang]/cookies/page.tsx")).toContain("updatedOn={COOKIES_LAST_UPDATED}");
  });

  it("seller_leads: fuera de Production es prueba; el admin las oculta por defecto", () => {
    expect(sellerLeadIsTest("production")).toBe(false);
    expect(sellerLeadIsTest("preview")).toBe(true);
    expect(sellerLeadIsTest(undefined)).toBe(true);
    expect(read("src/lib/listing-email-gate.server.ts")).toContain(
      "is_test: sellerLeadIsTest(process.env.VERCEL_ENV)",
    );
    const admin = read("src/app/[lang]/admin/seller-leads/page.tsx");
    expect(admin).toContain('if (!showTest) query = query.eq("is_test", false)');
  });
});
