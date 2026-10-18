// Landing de propietarios (/owners): enlaces y formato de los enlaces de Instantly.

export type Lang = "en" | "es";

/** "Talk to our team": el formulario con el tema "sell" ya elegido. */
export function ownersContactHref(lang: Lang): string {
  return `/${lang}/contact?topic=sell`;
}

/**
 * Enlace para las plantillas de Instantly. La campaña va en minúsculas, sin espacios ni "@"
 * (a-z, 0-9, ".", "_" y "-", hasta 64): otra forma se descarta al guardar el primer contacto.
 * Nunca lleva datos del propietario (nombre, dirección, email, owner_key).
 */
export function ownersInstantlyUrl(siteUrl: string, lang: Lang, campaign: string): string {
  const q = new URLSearchParams({ utm_source: "instantly", utm_medium: "email", utm_campaign: campaign });
  return `${siteUrl.replace(/\/$/, "")}/${lang}/owners?${q.toString()}`;
}
