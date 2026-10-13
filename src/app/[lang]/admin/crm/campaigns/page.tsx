import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { assertStaffWithUser } from "@/lib/admin-auth";
import { parseSegment } from "@/lib/crm/segment";
import { isInstantlyCampaignId } from "@/lib/crm/instantly.server";
import { dateTime, label } from "@/lib/crm/format";
import { CrmSegmentFields, describeSegment } from "@/components/admin/crm-segment-fields";

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  segment: Record<string, unknown>;
  created_at: string;
  crm_campaign_members: Array<{ count: number }>;
}

const inputCls =
  "border border-gold-soft bg-white px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-gold";

export default async function CrmCampaignsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const c = t(lang).crm;
  const sp = await searchParams;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_campaigns")
    .select("id,name,status,segment,created_at,crm_campaign_members(count)")
    .order("created_at", { ascending: false })
    .limit(200);
  const campaigns = (data ?? []) as unknown as CampaignRow[];

  async function createCampaign(formData: FormData) {
    "use server";
    // Server actions are callable on their own: re-check the role here.
    const { sb, userId } = await assertStaffWithUser(lang);
    const name = String(formData.get("name") ?? "").trim().slice(0, 120);
    const providerId = String(formData.get("provider_campaign_id") ?? "").trim().toLowerCase();
    if (!name || !isInstantlyCampaignId(providerId)) redirect(`/${lang}/admin/crm/campaigns?error=create`);
    const { data: row, error: insErr } = await sb
      .from("crm_campaigns")
      .insert({
        name,
        channel: "email",
        provider: "instantly",
        provider_campaign_id: providerId,
        segment: parseSegment(formData),
        created_by: userId,
      })
      .select("id")
      .single();
    if (insErr || !row) {
      console.error(JSON.stringify({ event: "crm_campaign_create_failed", code: insErr?.code }));
      redirect(`/${lang}/admin/crm/campaigns?error=create`);
    }
    redirect(`/${lang}/admin/crm/campaigns/${row.id}`);
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-ink/60 max-w-3xl">{c.campaigns.intro}</p>

      {sp.error === "create" && (
        <p className="border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800">{c.campaigns.createError}</p>
      )}
      {error && <p className="border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800">{c.loadError}</p>}

      {!error && campaigns.length === 0 ? (
        <p className="text-sm text-ink/55 italic">{c.campaigns.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-ink/55 border-b border-gold-soft">
                <th className="py-3 pr-4">{c.campaigns.colName}</th>
                <th className="py-3 pr-4">{c.campaigns.colStatus}</th>
                <th className="py-3 pr-4 text-right">{c.campaigns.colMembers}</th>
                <th className="py-3">{c.campaigns.colCreated}</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((cp) => (
                <tr key={cp.id} className="border-b border-gold-soft/50">
                  <td className="py-3 pr-4">
                    <Link href={`/${lang}/admin/crm/campaigns/${cp.id}`} className="text-ink hover:text-gold">
                      {cp.name}
                    </Link>
                    <span className="block text-xs text-ink/50">{describeSegment(c, parseSegment(cp.segment))}</span>
                  </td>
                  <td className="py-3 pr-4 text-xs">{label(c.campaignStatuses, cp.status)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{cp.crm_campaign_members?.[0]?.count ?? 0}</td>
                  <td className="py-3 text-xs text-ink/70 whitespace-nowrap">{dateTime(lang, cp.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="flex flex-col gap-4 border border-gold-soft p-5">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-ink/70">{c.campaigns.newTitle}</h2>
        <form action={createCampaign} className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-ink/55">
              {c.campaigns.name}
              <input name="name" required maxLength={120} className={`${inputCls} w-72`} />
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-ink/55">
              {c.campaigns.instantlyId}
              <input
                name="provider_campaign_id"
                required
                pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                placeholder="01a1318c-d386-72d0-89f1-ff301dad5bcb"
                className={`${inputCls} w-96 font-mono text-xs`}
              />
            </label>
          </div>
          <p className="text-xs text-ink/55 max-w-2xl">{c.campaigns.instantlyIdHelp}</p>
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">{c.campaigns.segmentTitle}</span>
            <div className="flex flex-wrap items-end gap-3">
              <CrmSegmentFields c={c} value={{}} />
            </div>
          </div>
          <button
            type="submit"
            className="self-start bg-ink px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-ivory hover:bg-gold transition-colors"
          >
            {c.campaigns.create}
          </button>
        </form>
      </section>
    </div>
  );
}
