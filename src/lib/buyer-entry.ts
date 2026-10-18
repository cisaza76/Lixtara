// A dónde lleva cada entrada de comprador ("Buy" del menú, CTAs de compradores) según haya o
// no propiedades en /properties. Con el catálogo vacío nunca se manda al comprador a una
// página sin fichas: va a la sección de compradores o al formulario con el tema "buy" ya
// elegido. Cuando hay propiedades (listings propios activos, o el IDX encendido en el host
// licenciado) se vuelve al catálogo, sin tocar código.

export type Lang = "en" | "es";

export function buyerContactHref(lang: Lang): string {
  return `/${lang}/contact?topic=buy`;
}

/** "Buy" del menú: el catálogo si tiene fichas; si no, la sección de compradores del inicio. */
export function buyNavHref(lang: Lang, catalogHasListings: boolean): string {
  return catalogHasListings ? `/${lang}/properties` : `/${lang}#buyers`;
}

/** CTA principal de compradores: el catálogo si tiene fichas; si no, el formulario de compra. */
export function buyerCtaHref(lang: Lang, catalogHasListings: boolean): string {
  return catalogHasListings ? `/${lang}/properties` : buyerContactHref(lang);
}

/** Lee `?topic=` de /contact; cualquier otro valor deja el tema por defecto. */
export function contactTopicFromQuery<T extends string>(
  raw: string | string[] | undefined,
  topics: readonly T[],
  fallback: T,
): T {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && (topics as readonly string[]).includes(v) ? (v as T) : fallback;
}
