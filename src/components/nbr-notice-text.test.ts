// El aviso tal como se dibuja: inglés (rige) y español al lado, con la línea de que rige el
// inglés; la casilla E-SIGN es aparte y obligatoria.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EsignConsent, NbrNoticeText } from "@/components/nbr-notice-text";
import { NBR_ES_GOVERNING_LINE, NBR_NOTICE_EN, NBR_NOTICE_ES } from "@/lib/nbr-notice";

describe("NbrNoticeText", () => {
  for (const lang of ["en", "es"] as const) {
    it(`${lang}: dos columnas, inglés primero; el español dice que rige el inglés`, () => {
      const html = renderToStaticMarkup(createElement(NbrNoticeText, { lang }));
      expect(html).toContain("md:grid-cols-2");
      const en = html.indexOf('data-nbr-column="en"');
      const es = html.indexOf('data-nbr-column="es"');
      expect(en).toBeGreaterThan(0);
      expect(es).toBeGreaterThan(en);
      expect(html.slice(es)).toContain(NBR_ES_GOVERNING_LINE);
      expect(html).toContain(`<p class="font-bold">${NBR_NOTICE_EN.lead}</p>`);
      expect(html).toContain(`<p class="font-bold">${NBR_NOTICE_ES.lead}</p>`);
      for (const d of NBR_NOTICE_EN.duties) expect(html).toContain(d);
    });
  }
});

describe("EsignConsent", () => {
  it("casilla obligatoria con el texto del consentimiento", () => {
    const html = renderToStaticMarkup(createElement(EsignConsent, { lang: "es" }));
    const input = html.match(/<input[^>]*name="esign_consent"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('type="checkbox"');
    expect(input).toContain("required");
    expect(html).toContain("15 U.S.C. §7001(c)");
  });
});
