// POST /api/webhooks/docusign
// DocuSign Connect posts envelope status changes here. We accept the
// default Connect payload (JSON), look up our `agreements` row by
// envelope_id, and flip status on lifecycle events. On 'completed' we
// stamp `properties.agreement_status` so Step 8 can gate payment.
//
// Connect auth: DocuSign supports HMAC signatures on Connect webhooks but
// the verification scheme requires per-account config in their dashboard.
// For F2.2.B we trust the envelope_id (it's a 36-char GUID; attacker
// can't guess one tied to our account) and do canonical status lookup
// from DocuSign via authedRequest to avoid spoofing.

import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { refreshAgreement } from "@/lib/agreement-refresh";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase service env vars missing");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

interface ConnectPayload {
  event?: string;
  apiVersion?: string;
  data?: {
    envelopeId?: string;
    accountId?: string;
    envelopeSummary?: {
      status?: string;
      completedDateTime?: string;
      declinedDateTime?: string;
    };
  };
}

export async function POST(req: Request) {
  let payload: ConnectPayload;
  try {
    payload = (await req.json()) as ConnectPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 200 });
  }

  const envelopeId = payload.data?.envelopeId;
  if (!envelopeId) {
    return NextResponse.json(
      { ok: false, error: "no_envelope_id" },
      { status: 200 },
    );
  }

  const supabase = serviceClient();
  const { data: agreement } = await supabase
    .from("agreements")
    .select("id, property_id, envelope_id, status")
    .eq("envelope_id", envelopeId)
    .maybeSingle();

  if (!agreement) {
    // Unknown envelope (could be from another env). Ack so DocuSign stops
    // retrying.
    return NextResponse.json({ ok: true, note: "unknown_envelope" });
  }

  // DocuSign is re-queried inside refreshAgreement (anti-spoofing), which also
  // sends the "agreement signed" email exactly once.
  const status = await refreshAgreement(agreement);
  return NextResponse.json({ ok: true, status });
}
