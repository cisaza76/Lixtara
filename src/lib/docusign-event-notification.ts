// eventNotification por sobre: DocuSign avisa a /api/webhooks/docusign de los cambios de
// estado de CADA sobre que crea el sitio, sin depender de una configuración de Connect a
// nivel de cuenta (que no todos los planes de API incluyen). Mismo formato que Connect
// (SIM, REST v2.1 en JSON), así que el receptor (src/lib/docusign-connect.ts) no cambia.
//
// Solo en Production. Preview y Development no lo ponen: siguen con el Connect de la cuenta
// Demo, y Preview comparte la base con Production.
//
// Autenticación de la entrega, en este orden:
//   - includeHMAC: DocuSign firma con las claves HMAC de la cuenta (Settings → Connect →
//     Connect Keys) → DOCUSIGN_CONNECT_HMAC_KEY.
//   - Respaldo si la cuenta no permite claves HMAC: DOCUSIGN_WEBHOOK_TOKEN viaja en la URL
//     (?token=…) y el receptor lo compara en tiempo constante.
// En los dos casos el receptor no confía en el payload: solo dispara refreshAgreement.
// Runbook: docs/superpowers/runbooks/2026-11-10-docusign-produccion.md
import { webhookTokenFromEnv, WEBHOOK_TOKEN_PARAM } from "@/lib/docusign-connect";

/** Eventos suscritos en cada sobre. `envelope-declined` incluido: el dashboard lo distingue. */
export const ENVELOPE_EVENTS = [
  "envelope-sent",
  "envelope-delivered",
  "envelope-completed",
  "envelope-declined",
  "envelope-voided",
  "recipient-completed",
] as const;

export const DOCUSIGN_WEBHOOK_PATH = "/api/webhooks/docusign";

export interface EnvelopeEventNotification {
  url: string;
  requireAcknowledgment: "true";
  includeHMAC: "true";
  loggingEnabled: "true";
  deliveryMode: "SIM";
  eventData: { version: "restv2.1"; format: "json" };
  events: string[];
}

/**
 * El `eventNotification` de un sobre nuevo, o `undefined` fuera de Production. Sin una
 * NEXT_PUBLIC_SITE_URL https válida en Production tampoco se pone (y se avisa en los logs):
 * el sobre se crea igual y el estado se sigue leyendo de DocuSign en el paso 7 y en el admin.
 */
export function envelopeEventNotification(
  env: NodeJS.ProcessEnv = process.env,
): EnvelopeEventNotification | undefined {
  if (env.VERCEL_ENV !== "production") return undefined;

  let origin: string;
  try {
    const site = new URL(env.NEXT_PUBLIC_SITE_URL ?? "");
    if (site.protocol !== "https:") throw new Error("not https");
    origin = site.origin;
  } catch {
    console.error(JSON.stringify({ event: "docusign_event_notification_skipped", reason: "site_url_invalid" }));
    return undefined;
  }

  const url = new URL(DOCUSIGN_WEBHOOK_PATH, origin);
  const token = webhookTokenFromEnv(env);
  if (token) url.searchParams.set(WEBHOOK_TOKEN_PARAM, token);

  return {
    url: url.toString(),
    requireAcknowledgment: "true",
    includeHMAC: "true",
    loggingEnabled: "true",
    deliveryMode: "SIM",
    eventData: { version: "restv2.1", format: "json" },
    events: [...ENVELOPE_EVENTS],
  };
}
