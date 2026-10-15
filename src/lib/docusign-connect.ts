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
// El estado del acuerdo nunca se toma del payload: lo resuelve `refresh`
// (refreshAgreement), que consulta DocuSign, actualiza la fila de forma condicionada y
// envía el email al vendedor una sola vez. Así una firma válida no basta para
// falsificar un "completed".
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

export interface AgreementRow {
  id: string;
  property_id: string;
  envelope_id: string | null;
  status: string;
}

export interface WebhookDeps {
  db: () => SupabaseClient;
  claimEvent: (db: SupabaseClient, eventId: string, eventType?: string) => Promise<"claimed" | "duplicate" | "unavailable">;
  /**
   * Trae el acuerdo al día desde DocuSign: estado vigente y si DocuSign respondió
   * (`fetched`). Nunca lanza.
   */
  refresh: (agreement: AgreementRow) => Promise<{ status: string; fetched: boolean }>;
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
    // 400: no se procesó. Connect lo marca como fallido en su registro en vez de "entregado".
    return ack({ ok: false, error: "bad_json" }, 400);
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
    return ack({ ok: false, error: "no_envelope_id" }, 400);
  }

  const { data: agreement, error: lookupError } = await db
    .from("agreements")
    .select("id, property_id, envelope_id, status")
    .eq("envelope_id", envelopeId)
    .maybeSingle();
  if (lookupError) {
    // Sin poder leer la base no sabemos si el sobre es nuestro: 503, Connect reintenta.
    console.error(JSON.stringify({ event: "docusign_connect_lookup_failed", message: lookupError.message }));
    return ack({ ok: false, error: "lookup_failed" }, 503);
  }
  // Sobre de otra integración de la cuenta: 200 a propósito (reintentar no lo haría nuestro).
  if (!agreement) {
    await log({ note: "unknown_envelope" });
    return ack({ ok: true, note: "unknown_envelope" });
  }

  // refresh consulta DocuSign y condiciona la actualización al estado leído: es
  // idempotente, un reintento nunca queda sin aplicar y el email al vendedor sale una
  // sola vez aunque lleguen entregas en paralelo. Si DocuSign no responde devuelve el
  // estado anterior; el poller del paso 7 y la revisión del admin lo vuelven a intentar.
  const { status: ourStatus, fetched } = await deps.refresh(agreement as AgreementRow);
  if (!fetched) {
    // DocuSign no respondió: el acuerdo quedó igual. 503 para que Connect reintente la
    // entrega (sin reclamarla: el reintento debe procesarse, no contarse como duplicado).
    await log({ resulting_status: ourStatus, note: "refresh_failed" });
    return ack({ ok: false, error: "refresh_failed", status: ourStatus }, 503);
  }

  // Deduplicación por entrega (mismo cuerpo = misma entrega reintentada): solo marca el
  // registro; los efectos laterales ya están protegidos dentro de refresh.
  const claim = await deps.claimEvent(db, digest, eventType ?? undefined);
  if (claim === "duplicate") {
    await log({ duplicate: true, resulting_status: ourStatus });
    return ack({ ok: true, note: "duplicate", status: ourStatus });
  }
  await log({ resulting_status: ourStatus });

  return ack({ ok: true, status: ourStatus });
}
