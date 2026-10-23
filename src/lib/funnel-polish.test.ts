import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dictionaries } from "@/lib/i18n";

// Ajustes del embudo y la cuenta (2026-10-18): salida del borrador anónimo en /sign-in, días en
// el MLS, fotos opcionales en Pro/Concierge, saludo del primer ingreso y mensajes propios de las
// casillas obligatorias.
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("salida del borrador anónimo", () => {
  it("/sign-in?other=1 no devuelve al paso 7 y avisa que el borrador se pierde", () => {
    const page = read("src/app/[lang]/sign-in/page.tsx");
    expect(page).toContain('const otherAccount = sp.other === "1";');
    expect(page).toContain("if (!otherAccount) await returnListingSessionToDraft(lang);");
    expect(page).toContain("{copy.otherAccountWarning}");
    // Un intento fallido conserva la salida (si no, el error lo devolvería al paso 7).
    expect(page).toContain('const keepOther = formData.get("other") === "1" ? "&other=1" : "";');
  });

  it("el paso 7 ofrece 'Iniciar sesión con otra cuenta' en sus dos estados", () => {
    const gate = read("src/components/account-gate.tsx");
    expect(gate).toContain("href={`/${lang}/sign-in?other=1`}");
    expect(gate.match(/\{otherAccount\}/g)).toHaveLength(2);
  });

  it.each(["en", "es"] as const)("%s: textos", (lang) => {
    const d = dictionaries[lang];
    expect(d.listingForm.step7.gateOtherAccount).toBe(lang === "en" ? "Sign in with a different account" : "Iniciar sesión con otra cuenta");
    expect(d.auth.signIn.otherAccountWarning).toMatch(lang === "en" ? /will be lost/ : /se pierde/);
  });
});

describe("panel", () => {
  it("los días cuentan desde mls_published_at; antes, 'Aún no está en el MLS'", () => {
    const page = read("src/app/[lang]/dashboard/page.tsx");
    expect(page).toContain("daysSince(l.mls_published_at)");
    expect(page).not.toContain("daysSince(l.created_at)");
    expect(JSON.stringify(dictionaries.en)).toContain('"metricNotOnMls":"Not on the MLS yet"');
    expect(JSON.stringify(dictionaries.es)).toContain('"metricNotOnMls":"Aún no está en el MLS"');
  });

  it("primer ingreso: 'Bienvenido' / 'Welcome'; después, 'de vuelta'", () => {
    expect(dictionaries.es.dashboard.titleFirst).toBe("Bienvenido");
    expect(dictionaries.en.dashboard.titleFirst).toBe("Welcome");
    expect(read("src/app/[lang]/dashboard/page.tsx")).toContain("const firstSession = isFirstSession(user);");
  });
});

describe("revisión del listado (paso 6)", () => {
  it("sin fotos, la sección queda incompleta en todos los planes (al menos la foto del frente)", () => {
    expect(dictionaries.en.listingForm.step6).not.toHaveProperty("photosOptional");
    expect(dictionaries.es.listingForm.step6).not.toHaveProperty("photosOptional");
    expect(read("src/app/[lang]/listing/new/page.tsx")).not.toContain("copy.step6.photosOptional");
  });
});

describe("casillas obligatorias: mensaje propio en el idioma de la página", () => {
  it("E-SIGN y reembolso: el botón no se desactiva; sin la casilla, mensaje y foco", () => {
    for (const f of ["src/components/agreement-button.tsx", "src/components/checkout-button.tsx"]) {
      const c = read(f);
      expect(c, f).toContain("{labels.consentRequired}");
      expect(c, f).toContain('role="alert"');
      expect(c, f).not.toMatch(/disabled=\{!accepted|disabled=\{!refundAck \|\| !accepted/);
    }
  });

  it.each(["en", "es"] as const)("%s: textos", (lang) => {
    const d = dictionaries[lang];
    expect(d.listingForm.step7.consentRequired.length).toBeGreaterThan(10);
    expect(d.listingForm.step8.consentRequired.length).toBeGreaterThan(10);
    expect(d.auth.errors.termsRequired.length).toBeGreaterThan(10);
  });
});
