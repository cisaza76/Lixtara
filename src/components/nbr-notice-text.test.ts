// El aviso tal como se dibuja: en /es la traducción de cortesía primero y el inglés que rige
// debajo, marcados; en /en solo el inglés. Primera oración en negrita.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NbrNoticeText } from "@/components/nbr-notice-text";
import { NBR_NOTICE_EN, NBR_NOTICE_ES } from "@/lib/nbr-notice";

describe("NbrNoticeText", () => {
  it("/es: cortesía primero, después la versión que rige", () => {
    const html = renderToStaticMarkup(createElement(NbrNoticeText, { lang: "es" }));
    const es = html.indexOf(NBR_NOTICE_ES.lead);
    const en = html.indexOf(NBR_NOTICE_EN.lead);
    expect(es).toBeGreaterThan(0);
    expect(en).toBeGreaterThan(es);
    expect(html).toContain("Traducción de cortesía. La versión en inglés, más abajo, es la que rige.");
    expect(html).toContain("Versión en inglés (la que rige)");
    expect(html).toContain(`<p class="font-bold">${NBR_NOTICE_EN.lead}</p>`);
    expect(html).toContain('lang="en"');
  });

  it("/en: solo el texto legal en inglés, completo", () => {
    const html = renderToStaticMarkup(createElement(NbrNoticeText, { lang: "en" }));
    expect(html).not.toContain(NBR_NOTICE_ES.lead);
    for (const d of NBR_NOTICE_EN.duties) expect(html).toContain(d);
    expect(html).toContain(NBR_NOTICE_EN.title);
  });
});
