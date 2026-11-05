import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cookiesDocFor } from "@/lib/legal/cookies";
import { privacyDoc } from "@/lib/legal/privacy";
import { COOKIES_LAST_UPDATED, LEGAL_LAST_UPDATED, PRIVACY_LAST_UPDATED } from "@/lib/legal/types";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Clarity (2026-10-16): graba el embudo, nunca /account, sin datos del usuario", () => {
  it("ningún <Link> de next lleva a /account: el header, el menú móvil y lo demás usan <a>", () => {
    for (const f of ["src/app/[lang]/layout.tsx", "src/components/mobile-menu.tsx"]) {
      const src = read(f);
      expect(src, f).toMatch(/<a\s+href=\{`\/\$\{lang\}\/account`\}/);
      expect(src, f).not.toMatch(/<Link\s+href=\{`\/\$\{lang\}\/account`\}/);
    }
  });

  it("los enlaces que salen de /account son <a> (Clarity se vuelve a cargar en el embudo)", () => {
    const page = read("src/app/[lang]/account/page.tsx");
    expect(page).not.toMatch(/<Link\s/);
    expect(page).toContain("href: `/${lang}/listing/new`");
  });

  it("el guard decide con needsFullLoad y recarga también tras redirect() de una server action", () => {
    const g = read("src/components/recording-guard.tsx");
    expect(g).toContain("needsFullLoad(window.location.pathname, url.pathname, consentGranted())");
    expect(g).toContain("if (needsFullLoad(from, pathname, consentGranted())) window.location.reload();");
    expect(g).not.toContain("clarityActive"); // entrar a /account recarga siempre
  });

  it("respaldo de máscara: los layouts de /account y /dashboard envuelven todo", () => {
    for (const f of ["src/app/[lang]/account/layout.tsx", "src/app/[lang]/dashboard/layout.tsx"]) {
      expect(read(f), f).toMatch(/<div data-clarity-mask="true" className="contents">\s*\{children\}\s*<\/div>/);
    }
  });

  it("las fotos del inmueble en /listing van enmascaradas (cuadrícula del paso 5, miniaturas del paso 6)", () => {
    expect(read("src/components/photo-grid-draggable.tsx")).toMatch(/<img\s+src=\{photo\.url\}\s+alt=""\s+data-clarity-mask="true"/);
    expect(read("src/app/[lang]/listing/new/page.tsx")).toMatch(
      /<div data-clarity-mask="true" className="grid grid-cols-4 sm:grid-cols-6 gap-2">\s*\{photos\.slice\(0, 12\)/,
    );
  });

  it("ningún script de Clarity en el código (solo por GTM)", () => {
    for (const f of ["src/app/[lang]/layout.tsx", "src/components/analytics-consent.tsx"]) {
      expect(read(f), f).not.toMatch(/clarity\.ms|yxc0vo851t/);
    }
  });

  it("política de cookies (con GTM): las cookies de Clarity, en EN y ES", () => {
    for (const lang of ["en", "es"] as const) {
      const doc = JSON.stringify(cookiesDocFor(lang, { gtm: true, posthog: false }));
      for (const c of ["_clck", "_clsk", "CLID", "MUID", "ANONCHK", "MR", "SM"]) expect(doc, `${lang} ${c}`).toContain(c);
      expect(doc, lang).toContain("/account");
    }
  });

  it("política de privacidad: sección 6.1 de Clarity en EN y ES, sin afirmar cumplimiento de una ley", () => {
    for (const lang of ["en", "es"] as const) {
      const s6 = privacyDoc[lang].sections.find((s) => s.heading.startsWith("6."))!;
      const sub = JSON.stringify(s6.sub);
      expect(sub, lang).toContain("Microsoft Clarity");
      expect(sub, lang).toContain("https://privacy.microsoft.com/privacystatement");
      expect(sub, lang).toContain("/account");
      expect(sub, lang).toContain("Stripe");
      expect(sub, lang).not.toMatch(/comply|complies|compliance|cumpl/i);
    }
    for (const lang of ["en", "es"] as const) {
      const s4 = JSON.stringify(privacyDoc[lang].sections.find((s) => s.heading.startsWith("4."))!.sub);
      expect(s4, lang).toContain("Google LLC (Google Analytics)");
      expect(s4, lang).toContain("Microsoft (Clarity)");
    }
    // 2026-10-24: textos legales v4 (Privacidad §4.6, §6.2 y §6.3; Cookies con Publicidad); la 6.1 sigue igual.
    expect(PRIVACY_LAST_UPDATED >= "2026-10-16").toBe(true);
    expect(COOKIES_LAST_UPDATED).toBe("2026-10-24");
    expect(LEGAL_LAST_UPDATED).toBe("2026-09-02");
  });
});
