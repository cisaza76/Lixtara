import { describe, it, expect } from "vitest";
import { dictionaries } from "@/lib/i18n";

// La compensación que ofrece el vendedor al agente del comprador no da prioridad ni más
// exposición en Zillow, Realtor.com ni Redfin: cada portal decide cómo muestra un listing.
// Ningún texto puede atar un porcentaje a la posición en un portal (owner, 2026-10-15).
const PROMESA = /(zillow|realtor)[^"]{0,40}(prioriti|prioridad|exposure|exposici[oó]n)|(prioriti|prioridad|maximi[sz]e[s]? (the )?exposure|maximiza la exposici[oó]n)[^"]{0,40}(zillow|realtor)/i;

describe("sin promesas de prioridad en los portales", () => {
  it("los diccionarios EN y ES no atan la comisión a Zillow / Realtor", () => {
    for (const lang of ["en", "es"] as const) {
      const texto = JSON.stringify(dictionaries[lang]);
      expect(texto.match(PROMESA)?.[0] ?? null, lang).toBeNull();
    }
  });
});
