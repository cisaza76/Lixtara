import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { t } from "@/lib/i18n";
import { sellerLeadIsTest } from "@/lib/listing-email-gate";
import { writtenOutsideProduction } from "@/lib/test-data";
import { LEGAL_DOCS } from "@/lib/legal/config";

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
    // Todos los obligatorios del flujo, leídos del código: <Field> (obligatorio por defecto)
    // salvo required={false}, y <input|select|textarea> con required.
    const names = new Set<string>();
    for (const src of [page, read("src/components/address-autocomplete.tsx")]) {
      for (const m of src.matchAll(/<(Field|input|select|textarea)\b((?:[^>"]|"[^"]*")*?)\/?>/g)) {
        const [, kind, attrs] = m;
        const name = attrs.match(/\bname="([^"]+)"/)?.[1];
        if (!name || attrs.includes("required={false}") || /type="hidden"/.test(attrs)) continue;
        if (kind === "Field" || /\brequired\b/.test(attrs)) names.add(name);
      }
    }
    for (const n of ["street", "city", "state", "zip", "list_price", "photos_rights_confirmed"]) {
      expect(names.has(n), n).toBe(true);
    }
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
    expect(LEGAL_DOCS.cookies.updated >= "2026-10-16").toBe(true);
    expect(read("src/app/[lang]/cookies/page.tsx")).toContain('docId="cookies"');
  });

  it("properties: fuera de Production el servidor marca is_test al crear (el guard no deja al vendedor)", () => {
    expect(writtenOutsideProduction("production")).toBe(false);
    expect(writtenOutsideProduction("preview")).toBe(true);
    const at = page.indexOf('.from("properties")\n      .insert(');
    expect(at).toBeGreaterThan(-1);
    expect(page.slice(at, at + 1200)).toContain("await markPropertyIfOutsideProduction(created!.id);");
    const helper = read("src/lib/test-data.server.ts");
    expect(helper).toContain("if (!writtenOutsideProduction(process.env.VERCEL_ENV)) return;");
    expect(helper).toMatch(/createService\(\)\s*\.from\("properties"\)\s*\.update\(\{ is_test: true \}\)/);
  });

  it("/sign-in precarga el correo del paso 1 solo en el regreso con restore=1", () => {
    const signIn = read("src/app/[lang]/sign-in/page.tsx");
    expect(signIn).toContain("isStep1RestoreNext(sp.next)");
    expect(signIn).toContain("defaultValue={step1Email}");
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
