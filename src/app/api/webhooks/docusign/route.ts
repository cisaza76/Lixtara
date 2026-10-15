// POST /api/webhooks/docusign
// DocuSign Connect avisa aquí los cambios de estado de un sobre. Lógica en
// src/lib/docusign-connect.ts (#137):
//   - firma HMAC de Connect validada (X-DocuSign-Signature-N, tiempo constante); 401 si
//     no es válida, y en Production también si no hay clave configurada;
//   - deduplicación por entrega y registro de solo-inserción en `docusign_events`;
//   - el estado lo resuelve refreshAgreement (src/lib/agreement-refresh.ts): consulta
//     DocuSign (nunca el payload), cuenta la firma del vendedor aunque falte la
//     contrafirma y envía el email "acuerdo firmado" una sola vez.
import { createService } from "@/lib/supabase/service";
import { handleConnectWebhook } from "@/lib/docusign-connect";
import { claimWebhookEvent } from "@/lib/webhook-dedup";
import { refreshAgreement } from "@/lib/agreement-refresh";

export async function POST(req: Request) {
  return handleConnectWebhook(req, {
    db: createService,
    claimEvent: (db, eventId, eventType) => claimWebhookEvent(db, "docusign", eventId, eventType),
    refresh: refreshAgreement,
    env: process.env,
  });
}
