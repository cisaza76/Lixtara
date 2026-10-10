// Public contact channels. ÚNICA fuente para el teléfono/WhatsApp comercial y el buzón
// que recibe el formulario de /contact — no repetirlos en componentes ni en i18n.

export const CONTACT = {
  /** Inbox that receives /contact form submissions. */
  inboxEmail: "anamaria@lixtara.com",
  /** Commercial phone + WhatsApp, E.164. */
  phoneE164: "+17862103562",
  phoneDisplay: "+1 (786) 210-3562",
} as const;

export function telHref(): string {
  return `tel:${CONTACT.phoneE164}`;
}

/** wa.me link (digits only, no "+"), optionally with a prefilled message. */
export function whatsappHref(text?: string): string {
  const base = `https://wa.me/${CONTACT.phoneE164.replace(/\D/g, "")}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
