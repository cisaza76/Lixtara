// "Send segment to Instantly" for one campaign.
//
// Rules (CRM_BRIEF.md):
// - Owners are read ONLY from crm_sendable_email_owners, which already excludes
//   suppressions, bounces, unsubscribes, unverified emails and owners with an
//   active MLS listing. Never from crm_owners.
// - The snapshot of who entered the campaign goes to crm_campaign_members.
// - owner_key travels as an Instantly custom variable; the webhook uses it.
// - property_address (from the view: highest-score current property) is the other
//   custom variable. Owners without one are skipped and counted: a template that
//   names "your property at …" must never go out with a blank address.
//
// One call = at most one Instantly batch (1000 leads). Sending a big segment is a
// repeated, deliberate action ("send the next batch"), never a single click that
// loads tens of thousands of cold leads.
//
// Runs with the staff member's session client: RLS (is_crm_admin) gates every
// read and write. No service key.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addLeadsToCampaign,
  INSTANTLY_MAX_LEADS_PER_CALL,
  isInstantlyCampaignId,
  type AddLeadsResult,
  type InstantlyLead,
} from "@/lib/crm/instantly.server";
import { applySegment, parseSegment, segmentSelect } from "@/lib/crm/segment";

export const SENDABLE_VIEW = "crm_sendable_email_owners";
const PAGE = 1000;
const MAX_PAGES = 50; // scans at most 50k sendable owners per click

export type SendOutcome =
  | { ok: true; result: AddLeadsResult; batch: number; withoutAddress: number; moreRemaining: boolean }
  | { ok: false; error: "not_found" | "not_email" | "no_provider_id" | "finished" | "nothing_to_send" | "db" | "instantly" };

interface CampaignRow {
  id: string;
  channel: string;
  provider: string;
  provider_campaign_id: string | null;
  segment: unknown;
  status: string;
}

interface SendableRow {
  id: string;
  owner_key: string;
  email: string;
  pilot_group: string | null;
  property_address: string | null;
}

export async function sendSegmentToInstantly(input: {
  supabase: SupabaseClient;
  campaignId: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<SendOutcome> {
  const { supabase, campaignId, apiKey, fetchImpl } = input;

  const { data: campaign, error: cErr } = await supabase
    .from("crm_campaigns")
    .select("id,channel,provider,provider_campaign_id,segment,status")
    .eq("id", campaignId)
    .maybeSingle<CampaignRow>();
  if (cErr) return { ok: false, error: "db" };
  if (!campaign) return { ok: false, error: "not_found" };
  if (campaign.channel !== "email" || campaign.provider !== "instantly") return { ok: false, error: "not_email" };
  if (!isInstantlyCampaignId(campaign.provider_campaign_id)) return { ok: false, error: "no_provider_id" };
  if (campaign.status === "Terminada") return { ok: false, error: "finished" };

  // Who is already in this campaign (never re-sent).
  const already = new Set<string>();
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("crm_campaign_members")
      .select("owner_id")
      .eq("campaign_id", campaign.id)
      .order("owner_id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { ok: false, error: "db" };
    for (const r of (data ?? []) as Array<{ owner_id: string }>) already.add(r.owner_id);
    if (!data || data.length < PAGE) break;
  }

  // Next batch from the sendable view, highest score first.
  const segment = parseSegment(campaign.segment as Record<string, unknown>);
  const batch: Array<SendableRow & { property_address: string }> = [];
  let withoutAddress = 0;
  let moreRemaining = false;
  for (let page = 0; page < MAX_PAGES && !moreRemaining; page++) {
    const query = applySegment(
      supabase
        .from(SENDABLE_VIEW)
        .select(segmentSelect("id,owner_key,email,pilot_group,property_address", segment)),
      segment,
    );
    const { data, error } = await query
      .order("score", { ascending: false, nullsFirst: false })
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { ok: false, error: "db" };
    const rows = (data ?? []) as unknown as SendableRow[];
    for (const r of rows) {
      if (already.has(r.id) || !r.email) continue;
      const address = r.property_address?.trim();
      if (!address) {
        withoutAddress++;
        continue;
      }
      if (batch.length < INSTANTLY_MAX_LEADS_PER_CALL) batch.push({ ...r, property_address: address });
      else {
        moreRemaining = true;
        break;
      }
    }
    if (rows.length < PAGE) break;
  }
  if (batch.length === 0) return { ok: false, error: "nothing_to_send" };

  const leads: InstantlyLead[] = batch.map((r) => ({
    email: r.email,
    custom_variables: { owner_key: r.owner_key, property_address: r.property_address },
  }));

  let result: AddLeadsResult;
  try {
    result = await addLeadsToCampaign(
      { apiKey, campaignId: campaign.provider_campaign_id, leads },
      fetchImpl,
    );
  } catch (err) {
    console.error(JSON.stringify({
      event: "crm_instantly_add_leads_failed",
      campaign_id: campaign.id,
      message: err instanceof Error ? err.message.slice(0, 300) : String(err),
    }));
    return { ok: false, error: "instantly" };
  }

  // Snapshot: only the leads Instantly actually created in the campaign.
  const members = result.createdIndexes.map((i) => ({
    campaign_id: campaign.id,
    owner_id: batch[i].id,
    pilot_group: batch[i].pilot_group,
  }));
  if (members.length > 0) {
    const { error } = await supabase
      .from("crm_campaign_members")
      .upsert(members, { onConflict: "campaign_id,owner_id", ignoreDuplicates: true });
    if (error) {
      // Instantly already has them; a later send reports them as duplicated, not re-added.
      console.error(JSON.stringify({
        event: "crm_campaign_members_insert_failed",
        campaign_id: campaign.id,
        count: members.length,
        code: error.code,
      }));
      return { ok: false, error: "db" };
    }
  }
  if (campaign.status === "Borrador") {
    await supabase.from("crm_campaigns").update({ status: "Activa" }).eq("id", campaign.id);
  }

  return { ok: true, result, batch: batch.length, withoutAddress, moreRemaining };
}
