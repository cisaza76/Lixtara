// POST /api/agreement/sync  — body: { property_id }
//
// Robustness path for embedded signing: instead of waiting for the DocuSign
// Connect webhook to flip the agreement status (which hangs the signing step
// if Connect is misconfigured or lagging), the client poller calls this to
// re-fetch the envelope status DIRECTLY from DocuSign and update the row.
// Canonical-source re-fetch — independent of the webhook.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getEnvelopeStatus, mapEnvelopeStatus } from "@/lib/docusign";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";

export const maxDuration = 30;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

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
    { label: "agreement:sync", message: "Too many status checks — wait a moment." },
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
    .select("id, envelope_id, status")
    .eq("property_id", propertyId)
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!agreement?.envelope_id) {
    return NextResponse.json({ status: agreement?.status ?? "none" });
  }
  // Already terminal — don't bother DocuSign.
  if (agreement.status === "completed" || agreement.status === "signed") {
    return NextResponse.json({ status: agreement.status });
  }

  let mapped: string = agreement.status;
  let signedAt: string | null = null;
  try {
    const fresh = await getEnvelopeStatus(agreement.envelope_id);
    mapped = mapEnvelopeStatus(fresh.status);
    if (fresh.completedDateTime) signedAt = fresh.completedDateTime;
  } catch (e) {
    console.error("agreement sync: DocuSign fetch failed", e);
    return NextResponse.json({ status: agreement.status, synced: false });
  }

  // Status flips go through the service-role client (the owner has no UPDATE
  // RLS policy on agreements — by design, flips are server-controlled).
  if (mapped !== agreement.status) {
    const sc = serviceClient();
    if (sc) {
      const update: Record<string, unknown> = {
        status: mapped,
        updated_at: new Date().toISOString(),
      };
      if (mapped === "completed" || mapped === "signed") {
        update.signed_at = signedAt ?? new Date().toISOString();
      }
      await sc.from("agreements").update(update).eq("id", agreement.id);
    }
  }

  return NextResponse.json({ status: mapped });
}
