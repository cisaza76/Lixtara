// POST /api/agreement/sync  — body: { property_id }
//
// Robustness path for embedded signing: instead of waiting for the DocuSign
// Connect webhook to flip the agreement status (which hangs the signing step
// if Connect is misconfigured or lagging), the client poller calls this to
// re-fetch the envelope status DIRECTLY from DocuSign and update the row.
// Canonical-source re-fetch — independent of the webhook.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshAgreement } from "@/lib/agreement-refresh";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";

export const maxDuration = 30;


export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const limited = await enforceLimit(
    apiLimiter("agreement:sync", 60, "1 h"),
    `u:${user.id}`,
    { label: "agreement:sync", message: "Too many status checks. Please wait a moment." },
  );
  if (limited) return limited;

  let body: { property_id?: string };
  try {
    body = (await req.json()) as { property_id?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const propertyId = body.property_id;
  if (!propertyId) {
    return NextResponse.json({ error: "property_id_required" }, { status: 400 });
  }

  // RLS own-select + explicit owner filter: a user can only sync their own
  // agreement.
  const { data: agreement } = await supabase
    .from("agreements")
    .select("id, envelope_id, status, property_id")
    .eq("property_id", propertyId)
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!agreement) return NextResponse.json({ status: "none" });

  const status = await refreshAgreement(agreement);
  return NextResponse.json({ status });
}
