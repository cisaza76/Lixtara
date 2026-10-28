// Aviso NBR, lado servidor: crear el enlace para aceptarlo, registrar la aceptación con su
// evidencia y mandar el PDF al comprador y a la broker. Tabla buyer_nbr_notices (migración
// 20261029120000), escrita solo con la clave secreta.
//
// Lo usa también Loui (crea el aviso pendiente de una visita pedida por chat). Por eso este
// módulo no lee nada que llegue al modelo y no nombra las tablas de leads
// (src/lib/mls/ai-boundary.test.ts).
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONTACT } from "@/config/contact";
import { SITE_URL } from "@/lib/config";
import { sendNbrNoticeAccepted, sendNbrNoticeLink } from "@/lib/email";
import { renderNbrNoticePdf } from "@/lib/nbr-notice-pdf";
import { NBR_LINK_DAYS, NBR_NOTICE_VERSION, noticePlainText } from "@/lib/nbr-notice";

export type NbrSubject = { leadId: string } | { scheduleRequestId: string };

export interface NbrEvidence {
  fullName: string;
  email: string;
  phone: string | null;
  listingLabel: string | null;
  /** Sin definir = se conserva lo que guardó el envío del enlace. */
  propertyId?: string | null;
  listingKey?: string | null;
  lang: "en" | "es";
  ip: string;
  userAgent: string;
}

export interface NbrNoticeRow {
  id: string;
  lead_id: string | null;
  schedule_request_id: string | null;
  notice_version: string;
  sent_at: string | null;
  expires_at: string | null;
  accepted_at: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  listing_label: string | null;
  lang: string | null;
}

const COLUMNS =
  "id,lead_id,schedule_request_id,notice_version,sent_at,expires_at,accepted_at,full_name,email,phone,listing_label,lang";

export function noticeTextSha256(lang: string): string {
  return createHash("sha256").update(noticePlainText(lang), "utf8").digest("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const subjectColumns = (s: NbrSubject) =>
  "leadId" in s ? { lead_id: s.leadId, schedule_request_id: null } : { lead_id: null, schedule_request_id: s.scheduleRequestId };

/** IP y user agent de la petición, recortados a lo que guarda la tabla. */
export function requestEvidence(h: { get(name: string): string | null }): { ip: string; userAgent: string } {
  const xff = h.get("x-forwarded-for");
  const ip = (xff ? xff.split(",")[0]!.trim() : h.get("x-real-ip")) || "unknown";
  return { ip: ip.slice(0, 64), userAgent: (h.get("user-agent") || "unknown").slice(0, 500) };
}

/**
 * Aviso pendiente con un enlace de un solo uso (vence en NBR_LINK_DAYS días) y el correo al
 * comprador. Solo el hash del token queda en la base; el token va únicamente en el correo.
 */
export async function sendNbrLink(
  svc: SupabaseClient,
  subject: NbrSubject,
  to: { email: string; name: string | null; lang: "en" | "es"; listingLabel: string | null; propertyId?: string | null; listingKey?: string | null },
): Promise<{ ok: boolean }> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const { error } = await svc.from("buyer_nbr_notices").insert({
    ...subjectColumns(subject),
    notice_version: NBR_NOTICE_VERSION,
    token_hash: hashToken(token),
    sent_at: now.toISOString(),
    expires_at: new Date(now.getTime() + NBR_LINK_DAYS * 86_400_000).toISOString(),
    email: to.email.slice(0, 200),
    full_name: to.name?.slice(0, 120) ?? null,
    listing_label: to.listingLabel?.slice(0, 300) ?? null,
    property_id: to.propertyId ?? null,
    listing_key: to.listingKey ?? null,
    lang: to.lang,
  });
  if (error) {
    console.error(JSON.stringify({ event: "nbr_link_insert_failed", code: error.code }));
    return { ok: false };
  }
  const url = `${SITE_URL}/${to.lang}/showing-notice/${token}`;
  const sent = await sendNbrNoticeLink({ to: to.email, lang: to.lang, buyerName: to.name, url, days: NBR_LINK_DAYS });
  return { ok: sent.ok };
}

/** El aviso pendiente de ese enlace, o null si no existe, ya se aceptó o venció. */
export async function findOpenNotice(svc: SupabaseClient, token: string, now = new Date()): Promise<NbrNoticeRow | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const { data } = await svc.from("buyer_nbr_notices").select(COLUMNS).eq("token_hash", hashToken(token)).maybeSingle();
  const row = data as NbrNoticeRow | null;
  if (!row || row.accepted_at) return null;
  if (row.expires_at && new Date(row.expires_at) <= now) return null;
  return row;
}

function evidenceColumns(e: NbrEvidence, acceptedAt: string) {
  return {
    accepted_at: acceptedAt,
    notice_version: NBR_NOTICE_VERSION,
    full_name: e.fullName.slice(0, 120),
    email: e.email.slice(0, 200),
    phone: e.phone?.slice(0, 25) ?? null,
    listing_label: e.listingLabel?.slice(0, 300) ?? null,
    ...(e.propertyId !== undefined ? { property_id: e.propertyId } : {}),
    ...(e.listingKey !== undefined ? { listing_key: e.listingKey } : {}),
    lang: e.lang,
    ip: e.ip,
    user_agent: e.userAgent,
    notice_text_sha256: noticeTextSha256(e.lang),
  };
}

/** Aceptación en el mismo formulario de la solicitud: el aviso nace aceptado. */
export async function recordInlineAcceptance(svc: SupabaseClient, subject: NbrSubject, e: NbrEvidence): Promise<string | null> {
  const acceptedAt = new Date().toISOString();
  const { data, error } = await svc
    .from("buyer_nbr_notices")
    .insert({ ...subjectColumns(subject), ...evidenceColumns(e, acceptedAt) })
    .select("id")
    .single();
  if (error || !data) {
    console.error(JSON.stringify({ event: "nbr_inline_insert_failed", code: error?.code }));
    return null;
  }
  await deliverAcceptedPdf(svc, data.id as string, e, acceptedAt);
  return data.id as string;
}

/** Aceptación desde el enlace: solo si sigue pendiente y no venció (escritura condicional). */
export async function acceptFromLink(svc: SupabaseClient, noticeId: string, e: NbrEvidence): Promise<boolean> {
  const acceptedAt = new Date().toISOString();
  const { data, error } = await svc
    .from("buyer_nbr_notices")
    .update({ ...evidenceColumns(e, acceptedAt), token_hash: null })
    .eq("id", noticeId)
    .is("accepted_at", null)
    .gt("expires_at", acceptedAt)
    .select("id")
    .maybeSingle();
  if (error || !data) return false;
  await deliverAcceptedPdf(svc, noticeId, e, acceptedAt);
  return true;
}

/** PDF al comprador y a la broker (best-effort; la aceptación ya quedó guardada). */
async function deliverAcceptedPdf(svc: SupabaseClient, noticeId: string, e: NbrEvidence, acceptedAt: string): Promise<void> {
  try {
    const pdf = await renderNbrNoticePdf({
      lang: e.lang,
      fullName: e.fullName,
      email: e.email,
      phone: e.phone,
      listingLabel: e.listingLabel,
      noticeVersion: NBR_NOTICE_VERSION,
      acceptedAt,
      ip: e.ip,
      userAgent: e.userAgent,
      textSha256: noticeTextSha256(e.lang),
    });
    const common = { buyerName: e.fullName, listingLabel: e.listingLabel, pdf };
    const [buyer, broker] = await Promise.all([
      sendNbrNoticeAccepted({ ...common, to: e.email, lang: e.lang, recipient: "buyer", idempotencyKey: `nbr-accepted-buyer:${noticeId}` }),
      sendNbrNoticeAccepted({ ...common, to: CONTACT.inboxEmail, lang: "en", recipient: "broker", idempotencyKey: `nbr-accepted-broker:${noticeId}` }),
    ]);
    if (buyer.ok && broker.ok) {
      await svc.from("buyer_nbr_notices").update({ pdf_emailed_at: new Date().toISOString() }).eq("id", noticeId);
    }
  } catch (err) {
    // Sin datos del comprador en el log.
    console.error(JSON.stringify({ event: "nbr_pdf_failed", message: err instanceof Error ? err.message : String(err) }));
  }
}

/** Último aviso (aceptado primero) por lead o por solicitud de Loui, para el admin. */
export async function latestNotices(
  svc: SupabaseClient,
  column: "lead_id" | "schedule_request_id",
  ids: string[],
): Promise<Map<string, NbrNoticeRow>> {
  const out = new Map<string, NbrNoticeRow>();
  if (ids.length === 0) return out;
  const { data } = await svc.from("buyer_nbr_notices").select(COLUMNS).in(column, ids).order("created_at", { ascending: true });
  for (const row of (data ?? []) as NbrNoticeRow[]) {
    const key = row[column];
    if (!key) continue;
    const prev = out.get(key);
    // El aceptado gana; si no hay, el último enviado.
    if (!prev || !prev.accepted_at) out.set(key, row);
  }
  return out;
}
