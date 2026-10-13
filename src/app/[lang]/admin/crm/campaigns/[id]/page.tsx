import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isLocale, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { assertStaffWithUser } from "@/lib/admin-auth";
import { BROKERAGE, brokerageLicenseLine } from "@/config/brokerage";
import { applySegment, parseSegment, segmentSelect } from "@/lib/crm/segment";
import { campaignMetrics, NO_GROUP, rate, type EventRow, type MemberRow } from "@/lib/crm/metrics";
import { getInstantlyApiKey, isInstantlyCampaignId } from "@/lib/crm/instantly.server";
import { sendSegmentToInstantly, SENDABLE_VIEW } from "@/lib/crm/send-segment.server";
import { fill, label, UUID_RE } from "@/lib/crm/format";
import { describeSegment } from "@/components/admin/crm-segment-fields";

interface Campaign {
  id: string;
  name: string;
  channel: string;
  provider: string;
  provider_campaign_id: string | null;
  segment: Record<string, unknown>;
  status: string;
}

const SEND_ERRORS = [
  "not_found", "not_email", "no_provider_id", "finished", "nothing_to_send", "db", "instantly", "no_key",
] as const;

/** Reads every row of a campaign-scoped table, 1000 at a time (PostgREST page cap). */
async function readAll<T>(sb: SupabaseClient, table: string, columns: string, campaignId: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .eq("campaign_id", campaignId)
      .order("owner_id")
      .range(page * 1000, page * 1000 + 999);
    if (error || !data) break;
    out.push(...(data as unknown as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

export default async function CrmCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; id: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang) || !UUID_RE.test(id)) notFound();
  const c = t(lang).crm;
  const k = c.campaign;
  const sp = await searchParams;
  const self = `/${lang}/admin/crm/campaigns/${id}`;

  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from("crm_campaigns")
    .select("id,name,channel,provider,provider_campaign_id,segment,status")
    .eq("id", id)
    .maybeSingle<Campaign>();
  if (!campaign) notFound();
  const segment = parseSegment(campaign.segment);

  const [members, events, sendable] = await Promise.all([
    readAll<MemberRow>(supabase, "crm_campaign_members", "owner_id,pilot_group", id),
    readAll<EventRow>(supabase, "crm_outreach", "owner_id,event_type", id),
    applySegment(
      supabase.from(SENDABLE_VIEW).select(segmentSelect("id", segment), { count: "exact", head: true }),
      segment,
    ),
  ]);
  const { groups, total } = campaignMetrics(members, events);
  const groupOrder = ["Score", "Control", ...Object.keys(groups).filter((g) => g !== "Score" && g !== "Control")];
  const hasKey = getInstantlyApiKey() !== null;

  async function send() {
    "use server";
    // Server actions are callable on their own: re-check the role here.
    const { sb } = await assertStaffWithUser(lang);
    const apiKey = getInstantlyApiKey();
    if (!apiKey) redirect(`${self}?error=no_key`);
    const out = await sendSegmentToInstantly({ supabase: sb, campaignId: id, apiKey });
    if (!out.ok) redirect(`${self}?error=${out.error}`);
    const r = out.result;
    const sent = [
      out.batch, r.uploaded, r.inBlocklist, r.duplicated, r.skipped, r.invalidEmail,
      out.withoutAddress, out.moreRemaining ? 1 : 0,
    ];
    redirect(`${self}?sent=${sent.join(".")}`);
  }

  const sentParts = sp.sent?.split(".").map((n) => Number.parseInt(n, 10));
  const sentOk = sentParts?.length === 8 && sentParts.every(Number.isFinite);
  const sendError = (SEND_ERRORS as readonly string[]).includes(sp.error ?? "")
    ? k.errors[sp.error as (typeof SEND_ERRORS)[number]]
    : null;

  // brokerageLicenseLine() already starts with the legal name.
  const footer = [
    brokerageLicenseLine("en"),
    brokerageLicenseLine("es"),
    BROKERAGE.address,
    "Unsubscribe / Darse de baja: [unsubscribe link]",
  ].join("\n");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link href={`/${lang}/admin/crm/campaigns`} className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-ink">
          ← {k.back}
        </Link>
        <h2 className="font-display text-2xl text-ink">{campaign.name}</h2>
        <p className="text-xs text-ink/60">
          {label(c.campaignStatuses, campaign.status)} · {k.segment}: {describeSegment(c, segment)}
        </p>
        <p className="text-xs text-ink/60">
          {k.instantlyId}:{" "}
          {isInstantlyCampaignId(campaign.provider_campaign_id) ? (
            <span className="font-mono">{campaign.provider_campaign_id}</span>
          ) : (
            <span className="text-red-800">{k.missingInstantlyId}</span>
          )}
        </p>
      </div>

      {sentOk && sentParts && (
        <div className="border border-green-300 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          <p>
            {fill(k.sent, {
              batch: sentParts[0], uploaded: sentParts[1], blocklist: sentParts[2],
              duplicated: sentParts[3], skipped: sentParts[4], invalid: sentParts[5],
            })}
          </p>
          {sentParts[6] > 0 && <p className="mt-1">{fill(k.withoutAddress, { count: sentParts[6] })}</p>}
          {sentParts[7] === 1 && <p className="mt-1">{k.moreRemaining}</p>}
        </div>
      )}
      {sendError && (
        <p className="border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800">{sendError}</p>
      )}

      <section className="flex flex-col gap-3 border border-gold-soft p-5">
        <p className="text-sm">
          {k.sendableNow}: <strong className="tabular-nums">{sendable.count ?? 0}</strong>
        </p>
        <p className="text-xs text-ink/60 max-w-2xl">{k.sendHelp}</p>
        {!hasKey && <p className="text-sm text-red-800">{k.noApiKey}</p>}
        {campaign.channel === "email" && campaign.status !== "Terminada" && (
          <form action={send}>
            <button
              type="submit"
              disabled={!hasKey || !isInstantlyCampaignId(campaign.provider_campaign_id)}
              className="bg-ink px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-ivory hover:bg-gold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              {k.sendButton}
            </button>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-[11px] uppercase tracking-[0.2em] text-ink/70">{k.metricsTitle}</h3>
        <p className="text-xs text-ink/60 max-w-2xl">{k.metricsHelp}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-ink/55 border-b border-gold-soft">
                <th className="py-2 pr-4">{k.colGroup}</th>
                <th className="py-2 pr-4 text-right">{k.colMembers}</th>
                <th className="py-2 pr-4 text-right">{k.colSent}</th>
                <th className="py-2 pr-4 text-right">{k.colReplied}</th>
                <th className="py-2 pr-4 text-right">{k.colInterested}</th>
                <th className="py-2 pr-4 text-right">{k.colUnsubscribed}</th>
                <th className="py-2 text-right">{k.colBounced}</th>
              </tr>
            </thead>
            <tbody>
              {[...groupOrder.filter((g) => groups[g]).map((g) => [g === NO_GROUP ? c.none : g, groups[g]] as const),
                [k.total, total] as const].map(([name, m]) => (
                <tr key={name} className="border-b border-gold-soft/50 tabular-nums">
                  <td className="py-2 pr-4 font-sans">{name}</td>
                  <td className="py-2 pr-4 text-right">{m.members}</td>
                  <td className="py-2 pr-4 text-right">{m.sent}</td>
                  <td className="py-2 pr-4 text-right">{m.replied} <span className="text-ink/50">({rate(m.replied, m.members)})</span></td>
                  <td className="py-2 pr-4 text-right">{m.interested} <span className="text-ink/50">({rate(m.interested, m.members)})</span></td>
                  <td className="py-2 pr-4 text-right">{m.unsubscribed} <span className="text-ink/50">({rate(m.unsubscribed, m.members)})</span></td>
                  <td className="py-2 text-right">{m.bounced} <span className="text-ink/50">({rate(m.bounced, m.members)})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3 border border-gold-soft p-5">
        <h3 className="text-[11px] uppercase tracking-[0.2em] text-ink/70">{k.footerTitle}</h3>
        <p className="text-xs text-ink/60 max-w-2xl">{k.footerHelp}</p>
        <pre className="whitespace-pre-wrap bg-ivory-strong/40 p-4 text-xs text-ink">{footer}</pre>
      </section>
    </div>
  );
}
