import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

interface Lead {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  budget_min: number | null;
  budget_max: number | null;
  financing_type: string | null;
  timeline: string | null;
  first_time_buyer: boolean | null;
  qualification_score: number | null;
  qualification_level: string | null;
  behavioral_score: number | null;
  lead_quality: string | null;
  ai_summary: string | null;
  buyer_agreement_signed: boolean;
  estimated_rebate: number | null;
  assigned_agent_id: string | null;
  status: string;
}

const QUALITIES = ["all", "hot", "warm", "cold"] as const;
const STATUSES = [
  "new",
  "contacted",
  "qualified",
  "assigned",
  "closed",
  "lost",
] as const;
const QUALITY_BADGE: Record<string, string> = {
  hot: "border-red-300 bg-red-50 text-red-800",
  warm: "border-orange-300 bg-orange-50 text-orange-800",
  cold: "border-gold-soft bg-ivory-strong/40 text-ink/60",
};

export default async function AdminBuyerLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ quality?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const quality = QUALITIES.includes(sp.quality as (typeof QUALITIES)[number])
    ? (sp.quality as string)
    : "all";

  const supabase = await createClient();
  let query = supabase
    .from("buyer_leads")
    .select(
      "id,full_name,email,phone,budget_min,budget_max,financing_type,timeline,first_time_buyer,qualification_score,qualification_level,behavioral_score,lead_quality,ai_summary,buyer_agreement_signed,estimated_rebate,assigned_agent_id,status",
    )
    .order("created_at", { ascending: false });
  if (quality !== "all") query = query.eq("lead_quality", quality);
  const { data } = await query;
  const leads = (data ?? []) as Lead[];

  const { data: agentRows } = await supabase
    .from("agent_partners")
    .select("id,name")
    .eq("status", "active")
    .order("name");
  const agents = (agentRows ?? []) as Array<{ id: string; name: string }>;
  const agentName = new Map(agents.map((a) => [a.id, a.name]));

  async function assertStaff() {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/admin`);
    const [{ data: a }, { data: b }] = await Promise.all([
      supabase.rpc("has_role", { _role: "admin" }),
      supabase.rpc("has_role", { _role: "broker" }),
    ]);
    if (a !== true && b !== true) redirect(`/${lang}/dashboard`);
    return supabase;
  }

  async function assignAgent(formData: FormData) {
    "use server";
    const sb = await assertStaff();
    const agentId = String(formData.get("assigned_agent_id") ?? "");
    await sb
      .from("buyer_leads")
      .update({
        assigned_agent_id: agentId || null,
        status: agentId ? "assigned" : "qualified",
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(formData.get("id") ?? ""));
    revalidatePath(`/${lang}/admin/buyer-leads`);
  }

  async function updateLead(formData: FormData) {
    "use server";
    const next = String(formData.get("status") ?? "");
    if (!(STATUSES as readonly string[]).includes(next)) return;
    const sb = await assertStaff();
    await sb
      .from("buyer_leads")
      .update({
        status: next,
        notes: String(formData.get("notes") ?? "").slice(0, 2000).trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(formData.get("id") ?? ""));
    revalidatePath(`/${lang}/admin/buyer-leads`);
  }

  const budget = (lo: number | null, hi: number | null) => {
    if (lo == null && hi == null) return "—";
    const f = (n: number | null) => (n != null ? `$${n.toLocaleString()}` : "?");
    return `${f(lo)} – ${f(hi)}`;
  };

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl text-ink font-normal">Buyer Leads</h1>

      <div className="flex flex-wrap gap-2">
        {QUALITIES.map((qy) => (
          <Link
            key={qy}
            href={`/${lang}/admin/buyer-leads?quality=${qy}`}
            className={`px-3 py-2 text-[10px] uppercase tracking-[0.18em] border transition-colors ${
              quality === qy
                ? "border-gold bg-gold/10 text-ink"
                : "border-gold-soft text-ink/60 hover:border-gold/60"
            }`}
          >
            {qy}
          </Link>
        ))}
      </div>

      {leads.length === 0 ? (
        <p className="text-sm text-ink/55 italic">No buyer leads yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {leads.map((l) => (
            <li key={l.id} className="border border-gold-soft bg-ivory p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-1">
                  <p className="font-display text-lg text-ink">
                    {l.full_name ?? "Unknown buyer"}
                    {l.first_time_buyer ? " · first-time" : ""}
                  </p>
                  <p className="text-xs text-ink/60">
                    {[l.email, l.phone].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <p className="text-xs text-ink/55">
                    Budget {budget(l.budget_min, l.budget_max)}
                    {l.financing_type ? ` · ${l.financing_type}` : ""}
                    {l.timeline ? ` · ${l.timeline}` : ""}
                    {l.estimated_rebate != null
                      ? ` · rebate ~$${l.estimated_rebate.toLocaleString()}`
                      : ""}
                  </p>
                  <p className="text-[11px] text-ink/55">
                    {l.qualification_level
                      ? `Qual: ${l.qualification_level} (${l.qualification_score ?? "?"})`
                      : ""}
                    {l.behavioral_score != null
                      ? ` · Behavioral ${l.behavioral_score}`
                      : ""}
                    {l.buyer_agreement_signed ? " · agreement ✓" : ""}
                    {l.assigned_agent_id
                      ? ` · agent: ${agentName.get(l.assigned_agent_id) ?? "—"}`
                      : ""}
                  </p>
                  {l.ai_summary && (
                    <p className="text-xs text-ink/55 italic mt-1 max-w-2xl">
                      {l.ai_summary}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  {l.lead_quality && (
                    <span
                      className={`text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border ${QUALITY_BADGE[l.lead_quality] ?? QUALITY_BADGE.cold}`}
                    >
                      {l.lead_quality}
                    </span>
                  )}
                  <span className="text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border border-gold-soft bg-ivory-strong/40 text-ink/70">
                    {l.status}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-gold-soft pt-3">
                <form action={assignAgent} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={l.id} />
                  <select
                    name="assigned_agent_id"
                    defaultValue={l.assigned_agent_id ?? ""}
                    className="border border-gold-soft bg-ivory px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-gold"
                  >
                    <option value="">— assign agent —</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-ink text-ivory text-[10px] uppercase tracking-[0.22em]"
                  >
                    Assign
                  </button>
                </form>
                <form action={updateLead} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={l.id} />
                  <select
                    name="status"
                    defaultValue={l.status}
                    className="border border-gold-soft bg-ivory px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-gold"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    name="notes"
                    placeholder="Notes"
                    className="border border-gold-soft bg-ivory px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-gold flex-1 min-w-[160px]"
                  />
                  <button
                    type="submit"
                    className="px-4 py-1.5 border border-gold-soft text-[10px] uppercase tracking-[0.22em] text-ink/70 hover:border-gold hover:text-ink transition-colors"
                  >
                    Update
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
