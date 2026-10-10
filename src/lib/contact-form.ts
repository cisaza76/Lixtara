// Validation for the public /contact form (pure — tested in contact-form.test.ts).

export const CONTACT_TOPICS = ["sell", "buy", "consultation", "other"] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export interface ContactMessage {
  name: string;
  email: string;
  phone: string;
  topic: ContactTopic;
  message: string;
}

export type ContactError = "required" | "email" | "too_long" | "spam";

const MAX_MESSAGE = 4000;
const MAX_FIELD = 200;

export function parseContactForm(
  get: (key: string) => string | null | undefined,
): { ok: true; data: ContactMessage } | { ok: false; error: ContactError } {
  // Honeypot: a hidden field real visitors never fill.
  if ((get("website") ?? "").trim() !== "") return { ok: false, error: "spam" };

  const name = (get("name") ?? "").trim();
  const email = (get("email") ?? "").trim().toLowerCase();
  const phone = (get("phone") ?? "").trim();
  const message = (get("message") ?? "").trim();
  const rawTopic = (get("topic") ?? "").trim();
  const topic: ContactTopic = (CONTACT_TOPICS as readonly string[]).includes(rawTopic)
    ? (rawTopic as ContactTopic)
    : "other";

  if (!name || !email || !message) return { ok: false, error: "required" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "email" };
  if (name.length > MAX_FIELD || email.length > MAX_FIELD || phone.length > MAX_FIELD || message.length > MAX_MESSAGE) {
    return { ok: false, error: "too_long" };
  }
  return { ok: true, data: { name, email, phone, topic, message } };
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
