// Instantly API v2 — only the call the CRM needs: add leads to a campaign.
// Verified against the official OpenAPI (developer.instantly.ai, "Add leads in
// bulk to a campaign or list", operationId bulkAddLeads) on 2026-10-12:
//   POST https://api.instantly.ai/api/v2/leads/add
//   Authorization: Bearer <API key>   (scopes: leads:create | leads:all | all:create | all:all)
//   body: { campaign_id (uuid), leads: [{ email, custom_variables }] (1..1000), skip_if_in_workspace? }
//   200:  { status, total_sent, leads_uploaded, in_blocklist, duplicated_leads,
//           skipped_count?, invalid_email_count?, created_leads?: [{ index, id, email }] }
// The key is INSTANTLY_API_KEY (server-only). Never import this from a client component.

export const INSTANTLY_ADD_LEADS_URL = "https://api.instantly.ai/api/v2/leads/add";
export const INSTANTLY_MAX_LEADS_PER_CALL = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface InstantlyLead {
  email: string;
  // owner_key comes back on every webhook event (Instantly merges lead data into the
  // payload), so the webhook can identify the owner without relying on the email.
  custom_variables: { owner_key: string };
}

export interface AddLeadsResult {
  totalSent: number;
  uploaded: number;
  inBlocklist: number;
  duplicated: number;
  skipped: number;
  invalidEmail: number;
  /** Indexes (into the leads sent) that Instantly actually created. */
  createdIndexes: number[];
}

export class InstantlyError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "InstantlyError";
  }
}

export function getInstantlyApiKey(): string | null {
  const key = process.env.INSTANTLY_API_KEY?.trim();
  return key ? key : null;
}

export function isInstantlyCampaignId(id: string | null | undefined): id is string {
  return !!id && UUID_RE.test(id);
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export async function addLeadsToCampaign(
  input: { apiKey: string; campaignId: string; leads: InstantlyLead[] },
  fetchImpl: typeof fetch = fetch,
): Promise<AddLeadsResult> {
  if (!isInstantlyCampaignId(input.campaignId)) {
    throw new InstantlyError("invalid Instantly campaign id", null);
  }
  if (input.leads.length === 0 || input.leads.length > INSTANTLY_MAX_LEADS_PER_CALL) {
    throw new InstantlyError(`leads must be 1..${INSTANTLY_MAX_LEADS_PER_CALL}`, null);
  }

  let res: Response;
  try {
    res = await fetchImpl(INSTANTLY_ADD_LEADS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        campaign_id: input.campaignId,
        leads: input.leads,
        // Never contact the same person from two campaigns: an owner already
        // anywhere in the Instantly workspace is skipped.
        skip_if_in_workspace: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new InstantlyError(`network error: ${err instanceof Error ? err.message : String(err)}`, null);
  }

  if (!res.ok) {
    // The body may echo submitted emails: log only its first characters, server-side.
    const text = (await res.text().catch(() => "")).slice(0, 200);
    throw new InstantlyError(`Instantly ${res.status}: ${text}`, res.status);
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") throw new InstantlyError("unexpected response", res.status);
  const created = Array.isArray(body.created_leads) ? body.created_leads : [];
  return {
    totalSent: num(body.total_sent),
    uploaded: num(body.leads_uploaded),
    inBlocklist: num(body.in_blocklist),
    duplicated: num(body.duplicated_leads),
    skipped: num(body.skipped_count),
    invalidEmail: num(body.invalid_email_count),
    createdIndexes: created
      .map((c) => (c && typeof c === "object" ? (c as { index?: unknown }).index : undefined))
      .filter((i): i is number => typeof i === "number" && i >= 0 && i < input.leads.length),
  };
}
