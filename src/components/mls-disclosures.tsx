// Avisos obligatorios que acompañan a cualquier página que muestre contenido licenciado
// del MLS: Schedule A §10 / Schedule C §3 (copyright) y Schedule C §2 (fiabilidad).
//
// Un componente y no texto suelto para que sea una sola cosa que recordar: si una página
// muestra fichas del feed, monta esto. El año es dinámico porque el acuerdo escribe el
// aviso como "© YYYY" y uno quemado queda obsoleto el 1 de enero.
import type { Locale } from "@/lib/i18n";
import { mlsCopyrightNotice, reliabilityDisclaimer } from "@/lib/mls/display-compliance";

export function MlsDisclosures({ lang, year }: { lang: Locale; year: number }) {
  return (
    <div className="mt-16 border-t border-gold-soft pt-8 flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-ink/70">{reliabilityDisclaimer(lang)}</p>
      <p className="text-sm leading-relaxed text-ink/70">{mlsCopyrightNotice(year)}</p>
    </div>
  );
}
