// Alias de slugs en español → ruta canónica (issue #114).
//
// Las rutas son en inglés en ambos idiomas (/es/services, /en/services). Sin este mapa,
// alguien que escribe /servicios (o un buscador que guardó esa URL) acababa en
// /en/servicios → 404. Decisión: alias map en el proxy, NO slugs localizados — no cambia
// la estructura de rutas, ni hreflang, ni canonicals, ni el sitemap.
//
// Reglas:
//   /servicios          → /es/services       (slug español sin idioma ⇒ español)
//   /es/servicios       → /es/services
//   /en/servicios       → /en/services       (se respeta el idioma explícito)
//   /propiedad/<id>     → /es/property/<id>  (el resto del path se conserva)
// La query string la conserva quien llama (proxy) al clonar la URL.
import { isLocale, type Locale } from "@/lib/i18n";

/** Primer segmento en español → primer segmento canónico (ruta existente en src/app/[lang]). */
export const SPANISH_SLUG_ALIASES: Readonly<Record<string, string>> = {
  servicios: "services",
  propiedades: "properties",
  propiedad: "property",
  vender: "listing/new",
  "publicar-propiedad": "listing/new",
  nosotros: "about",
  "quienes-somos": "about",
  "acerca-de": "about",
  contacto: "contact",
  consultas: "consultations",
  asesorias: "consultations",
  privacidad: "privacy",
  "politica-de-privacidad": "privacy",
  terminos: "terms",
  "terminos-y-condiciones": "terms",
  "avisos-legales": "disclaimers",
  "iniciar-sesion": "sign-in",
  ingresar: "sign-in",
  registro: "sign-up",
  registrarse: "sign-up",
  panel: "dashboard",
  "mi-cuenta": "dashboard",
};

/**
 * Anclas de la landing con nombre español. No son rutas: /precios → /es#pricing.
 * (El fragmento no viaja al servidor, por eso se resuelve aquí y no en la página.)
 */
export const SPANISH_ANCHOR_ALIASES: Readonly<Record<string, string>> = {
  precios: "pricing",
  planes: "pricing",
  "como-funciona": "how-it-works",
  "preguntas-frecuentes": "faq",
};

export interface AliasTarget {
  pathname: string;
  hash?: string;
}

/**
 * Devuelve la ruta canónica si `pathname` empieza por un slug español conocido, o null.
 * Nunca devuelve el mismo path (no hay bucles de redirección).
 */
export function resolveSlugAlias(pathname: string): AliasTarget | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  let locale: Locale = "es";
  let rest = segments;
  if (isLocale(segments[0])) {
    locale = segments[0];
    rest = segments.slice(1);
  }
  if (rest.length === 0) return null;

  const first = decodeSafe(rest[0]).toLowerCase();
  const tail = rest.slice(1);

  const route = SPANISH_SLUG_ALIASES[first];
  if (route) {
    return { pathname: `/${[locale, route, ...tail].join("/")}` };
  }
  const anchor = SPANISH_ANCHOR_ALIASES[first];
  if (anchor && tail.length === 0) {
    return { pathname: `/${locale}`, hash: anchor };
  }
  return null;
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
