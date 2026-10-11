// POST /api/showing-requests: "Solicitar visita con Lixtara".
//
// Crea un lead para la broker. NO confirma la visita ni firma ningún acuerdo: la broker
// contacta al comprador, verifica su representación y gestiona el acuerdo antes del tour.
//
// Puertas, en orden:
//   1. Interruptor fail-closed (BUYER_SHOWING_REQUESTS_ENABLED) o staff → si no, 404.
//   2. Límite de uso por IP (Upstash).
//   3. Validación de lista cerrada (src/lib/buyer-leads.ts) + honeypot.
//   4. La ficha existe y es mostrable (para el feed IDX: además, exhibición permitida en
//      este host, salvo staff).
import { NextResponse } from "next/server";
import { CONTACT } from "@/config/contact";
import { SITE_URL } from "@/lib/config";
import { createService } from "@/lib/supabase/service";
import { apiLimiter, clientIp, enforceLimit } from "@/lib/ratelimit";
import { sendBrokerShowingRequest, sendShowingRequestReceived } from "@/lib/email";
import { captureServerEvent } from "@/lib/analytics.server";
import { CONSENT_VERSION, parseShowingRequest, respondByIso } from "@/lib/buyer-leads";
import {
  canUseShowingRequests,
  ensureBrokerOfRecord,
  insertShowingLead,
  resolveTarget,
} from "@/lib/buyer-leads.server";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const { allowed, staff } = await canUseShowingRequests();
  if (!allowed) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const limited = await enforceLimit(apiLimiter("showing-request", 5, "1 h"), clientIp(req), {
    message: "rate_limited",
    label: "showing request",
  });
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    const parsedBody: unknown = await req.json();
    body = parsedBody && typeof parsedBody === "object" ? (parsedBody as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const get = (k: string) => {
    const v = body[k];
    return typeof v === "string" ? v : typeof v === "boolean" ? String(v) : null;
  };

  const parsed = parseShowingRequest(get);
  // Honeypot: responder como si hubiera funcionado, sin crear nada.
  if (!parsed.ok && parsed.error === "spam") return NextResponse.json({ ok: true, exclusive: false });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const data = parsed.data;

  try {
    const svc = createService();
    const target = await resolveTarget(svc, data.target, { host: req.headers.get("host"), staff });
    if (!target) return NextResponse.json({ error: "target" }, { status: 404 });

    const brokerId = await ensureBrokerOfRecord(svc);
    const lead = await insertShowingLead(svc, data, brokerId);
    const exclusive = lead.status === "cancelled";
    await captureServerEvent({
      event: "buyer_lead_created",
      distinctId: `lead:${lead.id}`,
      props: { source: "showing_request", target: data.target.kind, exclusive },
    });

    // Acuerdo exclusivo con otro broker: el lead queda registrado (cancelado, con motivo)
    // y no se notifica a la broker ni se promete contacto.
    if (!exclusive) {
      await Promise.all([
        sendBrokerShowingRequest({
          to: CONTACT.inboxEmail,
          buyerName: data.fullName,
          buyerEmail: data.email,
          buyerPhone: data.phone,
          target: target.label,
          preferredTimes: data.preferredTimes,
          message: data.message,
          otherAgentStatus: data.otherAgentStatus,
          needsToSell: data.needsToSell,
          consentMarketing: data.consentMarketing,
          consentVersion: CONSENT_VERSION,
          respondBy: respondByIso(lead.createdAt),
          lang: data.lang,
          adminUrl: `${SITE_URL}/en/admin/buyer-leads?lead=${lead.id}`,
        }),
        sendShowingRequestReceived({
          to: data.email,
          lang: data.lang,
          buyerName: data.fullName,
          ownAddress: target.ownAddress,
        }),
      ]);
    }
    return NextResponse.json({ ok: true, exclusive });
  } catch (e) {
    // Sin datos del comprador en el log.
    console.error(JSON.stringify({
      event: "showing_request_failed",
      message: e instanceof Error ? e.message : String(e),
    }));
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
