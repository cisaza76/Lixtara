// DocuSign Connect: firma HMAC y procesamiento del webhook (#137 b, c).
//
// HMAC (c): Connect firma el cuerpo CRUDO con HMAC-SHA256 y manda el resultado en base64
// en X-DocuSign-Signature-1 (y -2, -3… durante una rotación de clave). Se acepta si
// alguna firma coincide con alguna clave configurada; la comparación es de tiempo
// constante. Docs: https://developers.docusign.com/platform/webhooks/connect/validate/
//
// Claves: DOCUSIGN_CONNECT_HMAC_KEY (y DOCUSIGN_CONNECT_HMAC_KEY_2 para rotar). Sin clave:
// en Production se rechaza todo (401) — fail-closed —; fuera de Production se procesa y
// el evento queda registrado con hmac_valid = false.
//
// El estado del acuerdo nunca se toma del payload: se consulta a DocuSign
// (getEnvelopeStatus). Así una firma válida no basta para falsificar un "completed".
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export function hmacKeysFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.DOCUSIGN_CONNECT_HMAC_KEY, env.DOCUSIGN_CONNECT_HMAC_KEY_2].filter(
    (k): k is string => typeof k === "string" && k.length > 0,
  );
}

export function computeConnectSignature(rawBody: string, key: string): string {
  return createHmac("sha256", key).update(rawBody, "utf8").digest("base64");
}

/** Firmas presentes: x-docusign-signature-1, -2, … (hasta 10). */
export function connectSignatures(headers: Headers): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const v = headers.get(`x-docusign-signature-${i}`);
    if (v) out.push(v.trim());
  }
  return out;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyConnectSignature(rawBody: string, headers: Headers, keys: string[]): boolean {
  if (keys.length === 0) return false;
  const sigs = connectSignatures(headers);
  if (sigs.length === 0) return false;
  for (const key of keys) {
    const expected = computeConnectSignature(rawBody, key);
    // Sin cortocircuito por firma: cada comparación es de tiempo constante.
    let match = false;
    for (const sig of sigs) match = safeEqual(sig, expected) || match;
    if (match) return true;
  }
  return false;
}

export function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export interface ConnectPayload {
  event?: string;
  generatedDateTime?: string;
  data?: {
    envelopeId?: string;
    envelopeSummary?: { status?: string };
  };
}

export type AgreementStatus =
  | "pending" | "sent" | "delivered" | "signed" | "completed" | "declined" | "voided" | "expired";

export interface WebhookDeps {
  db: () => SupabaseClient;
  getEnvelopeStatus: (envelopeId: string) => Promise<{ status: string; completedDateTime?: string }>;
  mapEnvelopeStatus: (s: string) => AgreementStatus;
  claimEvent: (db: SupabaseClient, eventId: string, eventType?: string) => Promise<"claimed" | "duplicate" | "unavailable">;
  onSigned: (db: SupabaseClient, propertyId: string) => Promise<void>;
  env: NodeJS.ProcessEnv;
}

const ack = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });

export async function handleConnectWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  const raw = await req.text();
  const keys = hmacKeysFromEnv(deps.env);
  const production = deps.env.VERCEL_ENV === "production";

  let hmacValid = false;
  if (keys.length > 0) {
    hmacValid = verifyConnectSignature(raw, req.headers, keys);
    if (!hmacValid) {
      // Sin registrar en la base: cualquiera podría llenarla con peticiones sin firma.
      console.warn(JSON.stringify({ event: "docusign_connect_bad_signature", signatures: connectSignatures(req.headers).length }));
      return ack({ ok: false, error: "invalid_signature" }, 401);
    }
  } else if (production) {
    console.error(JSON.stringify({ event: "docusign_connect_hmac_not_configured", action: "reject" }));
    return ack({ ok: false, error: "hmac_not_configured" }, 401);
  }

  let payload: ConnectPayload;
  try {
    payload = JSON.parse(raw) as ConnectPayload;
  } catch {
    return ack({ ok: false, error: "bad_json" });
  }

  const db = deps.db();
  const digest = sha256Hex(raw);
  const envelopeId = payload.data?.envelopeId ?? null;
  const eventType = payload.event ?? payload.data?.envelopeSummary?.status ?? null;
  const log = (fields: { duplicate?: boolean; resulting_status?: string | null; note?: string }) =>
    db.from("docusign_events").insert({
      envelope_id: envelopeId,
      event_type: eventType,
      payload_sha256: digest,
      hmac_valid: hmacValid,
      duplicate: fields.duplicate ?? false,
      resulting_status: fields.resulting_status ?? null,
      note: fields.note ?? null,
    }).then(({ error }) => {
      if (error) console.error(JSON.stringify({ event: "docusign_event_log_failed", message: error.message }));
    });

  if (!envelopeId) {
    await log({ note: "no_envelope_id" });
    return ack({ ok: false, error: "no_envelope_id" });
  }

  const { data: agreement } = await db
    .from("agreements")
    .select("id, property_id")
    .eq("envelope_id", envelopeId)
    .maybeSingle();
  if (!agreement) {
    await log({ note: "unknown_envelope" });
    return ack({ ok: true, note: "unknown_envelope" });
  }

  // Estado canónico: DocuSign, nunca el payload. Si no se puede consultar, 503 para que
  // Connect reintente (la entrega aún no se marcó como procesada).
  let fresh: { status: string; completedDateTime?: string };
  try {
    fresh = await deps.getEnvelopeStatus(envelopeId);
  } catch (e) {
    console.error("docusign envelope re-fetch failed:", e);
    await log({ note: "fetch_failed" });
    return ack({ ok: false, error: "fetch_failed" }, 503);
  }

  // Actualizar el acuerdo es idempotente (mismo estado canónico), así que va antes de la
  // deduplicación: un reintento tras un fallo nunca queda sin aplicar.
  const ourStatus = deps.mapEnvelopeStatus(fresh.status);
  const update: Record<string, unknown> = { status: ourStatus, updated_at: new Date().toISOString() };
  if (ourStatus === "completed" || ourStatus === "signed") {
    update.signed_at = fresh.completedDateTime ?? new Date().toISOString();
  }
  const { error: updateError } = await db.from("agreements").update(update).eq("id", agreement.id);
  if (updateError) {
    await log({ note: "update_failed" });
    return ack({ ok: false, error: "update_failed" }, 503);
  }

  // Deduplicación por entrega (mismo cuerpo = misma entrega reintentada), como Stripe:
  // solo la primera dispara efectos laterales (el email al vendedor).
  const claim = await deps.claimEvent(db, digest, eventType ?? undefined);
  if (claim === "duplicate") {
    await log({ duplicate: true, resulting_status: ourStatus });
    return ack({ ok: true, note: "duplicate", status: ourStatus });
  }
  await log({ resulting_status: ourStatus });

  if (ourStatus === "signed" || ourStatus === "completed") {
    try {
      await deps.onSigned(db, agreement.property_id as string);
    } catch (e) {
      console.error("docusign webhook email failed:", e);
    }
  }

  return ack({ ok: true, status: ourStatus });
}
