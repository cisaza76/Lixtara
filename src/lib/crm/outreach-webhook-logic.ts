// Lógica pura del webhook (sin dependencias de Deno ni Supabase) para poder probarla.
// Eventos documentados por Instantly (developer.instantly.ai/guides/webhook-events):
// email_sent, email_opened, reply_received, auto_reply_received, link_clicked,
// email_bounced, lead_unsubscribed, account_error, campaign_completed, lead_neutral,
// lead_interested, lead_not_interested, lead_meeting_booked, lead_meeting_completed,
// lead_closed, lead_out_of_office, lead_wrong_person (+ etiquetas personalizadas).

export type InstantlyPayload = {
  timestamp?: string;
  event_type?: string;
  campaign_id?: string;
  campaign_name?: string;
  lead_email?: string;
  step?: number | string;
  variant?: number | string;
  email_id?: string;
  reply_subject?: string;
  reply_text?: string;
  reply_text_snippet?: string;
  owner_key?: string; // variable personalizada que el admin envía al cargar el lead
  [k: string]: unknown;
};

// Eventos que no guardamos (ruido o internos de la cuenta de envío)
export const IGNORED = new Set(["email_opened", "link_clicked", "account_error", "campaign_completed"]);

export type OutreachRow = {
  event_hash: string;
  provider: string;
  event_type: string;
  email: string | null;
  owner_key: string | null;
  provider_campaign_id: string | null;
  step: number | null;
  reply_subject: string | null;
  reply_text: string | null;
  payload: InstantlyPayload;
  occurred_at: string;
};

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function toOutreachRow(p: InstantlyPayload): Promise<OutreachRow | null> {
  const eventType = String(p.event_type ?? "").trim();
  if (!eventType || IGNORED.has(eventType)) return null;

  const email = p.lead_email ? String(p.lead_email).trim().toLowerCase() : null;
  const occurred = p.timestamp && !isNaN(Date.parse(String(p.timestamp)))
    ? new Date(String(p.timestamp)).toISOString()
    : new Date().toISOString();
  const step = p.step === undefined || p.step === null || p.step === "" ? null : Number(p.step);

  // Idempotencia: Instantly puede reintentar; el mismo evento produce el mismo hash
  const hash = await sha256Hex(
    ["instantly", eventType, email ?? "", p.campaign_id ?? "", occurred, step ?? "", p.email_id ?? ""].join("|"),
  );

  return {
    event_hash: hash,
    provider: "instantly",
    event_type: eventType,
    email,
    owner_key: p.owner_key ? String(p.owner_key) : null,
    provider_campaign_id: p.campaign_id ? String(p.campaign_id) : null,
    step: Number.isFinite(step) ? step : null,
    reply_subject: p.reply_subject ? String(p.reply_subject) : null,
    reply_text: p.reply_text ? String(p.reply_text) : (p.reply_text_snippet ? String(p.reply_text_snippet) : null),
    payload: p,
    occurred_at: occurred,
  };
}
