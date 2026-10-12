// POST /api/crm/outreach-webhook
// Instantly posts outreach events here (Settings → Integrations → Webhooks, or
// POST /api/v2/webhooks). Each event is stored in crm_outreach; owner status and
// the suppression list are updated by the crm_apply_outreach_event trigger, so
// every provider follows the same rules.
//
// Auth: a shared secret, OUTREACH_WEBHOOK_TOKEN. Primary channel is a custom
// header configured on the Instantly webhook (`headers` field):
//   Authorization: Bearer <token>
// `?token=<token>` in the URL is accepted only as a fallback — a query string
// can end up in request logs, a header does not. Fail-closed when unset.
//
// Idempotency: crm_outreach.event_hash is unique; a retried event computes the
// same hash (see outreach-webhook-logic.ts) and is ignored.

import { NextResponse } from "next/server";
import { createService } from "@/lib/supabase/service";
import { apiLimiter, clientIp, enforceLimit } from "@/lib/ratelimit";
import {
  type InstantlyPayload,
  timingSafeEqual,
  toOutreachRow,
} from "@/lib/crm/outreach-webhook-logic";

// Instantly sends one event per request; batches are accepted but capped.
const MAX_EVENTS = 500;

function presentedToken(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return new URL(req.url).searchParams.get("token") ?? "";
}

export async function POST(req: Request) {
  const limited = await enforceLimit(
    apiLimiter("crm-outreach-webhook", 600, "1 m"),
    clientIp(req),
    { message: "Too many webhook calls.", label: "crm-outreach-webhook" },
  );
  if (limited) return limited;

  const expected = process.env.OUTREACH_WEBHOOK_TOKEN ?? "";
  if (!expected) {
    console.error("crm-outreach-webhook: OUTREACH_WEBHOOK_TOKEN is not set — rejecting");
  }
  if (!expected || !timingSafeEqual(presentedToken(req), expected)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  let body: InstantlyPayload | InstantlyPayload[];
  try {
    body = (await req.json()) as InstantlyPayload | InstantlyPayload[];
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }
  const events = Array.isArray(body) ? body : [body];
  if (events.length > MAX_EVENTS) {
    return new NextResponse("too many events", { status: 413 });
  }

  const supabase = createService();
  let stored = 0;
  let duplicates = 0;
  let ignored = 0;

  for (const ev of events) {
    if (!ev || typeof ev !== "object") {
      ignored++;
      continue;
    }
    const row = await toOutreachRow(ev);
    if (!row) {
      ignored++;
      continue;
    }

    // Owner: first by owner_key (custom variable sent when the lead was loaded
    // into Instantly), then by email.
    let ownerId: string | null = null;
    if (row.owner_key) {
      const { data } = await supabase
        .from("crm_owners").select("id").eq("owner_key", row.owner_key).maybeSingle();
      ownerId = data?.id ?? null;
    }
    if (!ownerId && row.email) {
      const { data } = await supabase
        .from("crm_owners").select("id").eq("email", row.email).maybeSingle();
      ownerId = data?.id ?? null;
    }

    let campaignId: string | null = null;
    if (row.provider_campaign_id) {
      const { data } = await supabase
        .from("crm_campaigns").select("id")
        .eq("provider", "instantly").eq("provider_campaign_id", row.provider_campaign_id)
        .maybeSingle();
      campaignId = data?.id ?? null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { owner_key: _ownerKey, ...insertable } = row;
    const { data, error } = await supabase
      .from("crm_outreach")
      .upsert(
        { ...insertable, owner_id: ownerId, campaign_id: campaignId },
        { onConflict: "event_hash", ignoreDuplicates: true },
      )
      .select("id");
    if (error) {
      console.error(JSON.stringify({
        event: "crm_outreach_insert_failed",
        event_type: row.event_type,
        code: error.code,
        message: error.message,
      }));
      // 500 → Instantly retries; the hash prevents duplicates when it does.
      return new NextResponse("storage error", { status: 500 });
    }
    if (data && data.length > 0) stored++;
    else duplicates++;
  }

  return NextResponse.json({ ok: true, stored, duplicates, ignored });
}
