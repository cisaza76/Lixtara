// Selector de idioma: la MISMA página en el otro idioma, no la portada. Todas las rutas
// existen en los dos idiomas (src/app/[lang]), así que basta con cambiar el primer segmento.
// La query se conserva (p. ej. ?id=…&step=3 del flujo de publicación).
import { isLocale, type Locale } from "@/lib/i18n";

export function alternateLocaleHref(pathname: string, search: string, target: Locale): string {
  const segments = pathname.split("/");
  // "/en/listing/new" → ["", "en", "listing", "new"]
  if (isLocale(segments[1] ?? "")) segments[1] = target;
  else segments.splice(1, 0, target);
  const path = segments.join("/").replace(/\/+$/, "") || `/${target}`;
  const query = search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `${path}${query}`;
}
