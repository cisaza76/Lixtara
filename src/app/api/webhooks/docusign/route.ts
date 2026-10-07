// POST /api/webhooks/docusign
// DocuSign Connect avisa aquí los cambios de estado de un sobre. Lógica en
// src/lib/docusign-connect.ts (#137):
//   - firma HMAC de Connect validada (X-DocuSign-Signature-N, tiempo constante); 401 si
//     no es válida, y en Production también si no hay clave configurada;
//   - deduplicación por entrega y registro de solo-inserción en `docusign_events`;
//   - estado canónico consultado a DocuSign (getEnvelopeStatus), nunca el del payload.
//     Con routingOrder 2 para la broker, "completed" significa las dos firmas.
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnvelopeStatus, mapEnvelopeStatus } from "@/lib/docusign";
import { handleConnectWebhook } from "@/lib/docusign-connect";
import { claimWebhookEvent } from "@/lib/webhook-dedup";
import { sendAgreementSigned } from "@/lib/email";

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase service env vars missing");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

async function notifySeller(supabase: SupabaseClient, propertyId: string): Promise<void> {
  const { data: prop } = await supabase
    .from("properties")
    .select("address_street,address_city,address_state,address_zip,owner_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop) return;
  const { data: sellerAuth } = await supabase.auth.admin.getUserById(prop.owner_id);
  const sellerEmail = sellerAuth.user?.email;
  if (!sellerEmail) return;
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lixtara.vercel.app";
  await sendAgreementSigned({
    to: sellerEmail,
    propertyAddress: `${prop.address_street}, ${prop.address_city}, ${prop.address_state} ${prop.address_zip}`,
    paymentUrl: `${origin}/en/listing/new?id=${propertyId}&step=8`,
  });
}

export async function POST(req: Request) {
  return handleConnectWebhook(req, {
    db: serviceClient,
    getEnvelopeStatus,
    mapEnvelopeStatus,
    claimEvent: (db, eventId, eventType) => claimWebhookEvent(db, "docusign", eventId, eventType),
    onSigned: notifySeller,
    env: process.env,
  });
}
