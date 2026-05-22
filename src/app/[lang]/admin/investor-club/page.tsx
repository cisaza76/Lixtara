import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

interface Member {
  id: string;
  applicant_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  properties_closed_last_12mo: number | null;
  properties_planned_next_12mo: number | null;
  property_types: string[] | null;
  average_property_value: number | null;
  proposed_tier: string | null;
  status: string;
  rejection_reason: string | null;
  internal_notes: string | null;
}

const STATUSES = ["all", "pending", "approved", "rejected"] as const;

export default async function AdminInvestorClubPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number])
    ? (sp.status as string)
    : "all";

  const supabase = await createClient();
  let query = supabase
    .from("investor_club_members")
    .select(
      "id,applicant_name,email,phone,company,properties_closed_last_12mo,properties_planned_next_12mo,property_types,average_property_value,proposed_tier,status,rejection_reason,internal_notes",
    )
    .order("created_at", { ascending: false });
  if (status !== "all") query = query.eq("status", status);
  const { data } = await query;
  const members = (data ?? []) as Member[];

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
    return { sb: supabase, userId: user.id };
  }

  async function approve(formData: FormData) {
    "use server";
    const { sb, userId } = await assertStaff();
    await sb
      .from("investor_club_members")
      .update({
        status: "approved",
        approved_by: userId,
        approved_at: new Date().toISOString(),
        internal_notes:
          String(formData.get("internal_notes") ?? "").trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(formData.get("id") ?? ""));
    revalidatePath(`/${lang}/admin/investor-club`);
  }

  async function reject(formData: FormData) {
    "use server";
    const { sb } = await assertStaff();
    await sb
      .from("investor_club_members")
      .update({
        status: "rejected",
        rejection_reason:
          String(formData.get("rejection_reason") ?? "").trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(formData.get("id") ?? ""));
    revalidatePath(`/${lang}/admin/investor-club`);
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl text-ink font-normal">
        Investor Club
      </h1>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/${lang}/admin/investor-club?status=${s}`}
            className={`px-3 py-2 text-[10px] uppercase tracking-[0.18em] border transition-colors ${
              status === s
                ? "border-gold bg-gold/10 text-ink"
                : "border-gold-soft text-ink/60 hover:border-gold/60"
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-ink/55 italic">No applications.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {members.map((m) => (
            <li
              key={m.id}
              className="border border-gold-soft bg-ivory p-5 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-1">
                  <p className="font-display text-lg text-ink">
                    {m.applicant_name ?? "Applicant"}
                    {m.company ? ` · ${m.company}` : ""}
                  </p>
                  <p className="text-xs text-ink/60">
                    {[m.email, m.phone].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <p className="text-xs text-ink/55">
                    {[
                      m.properties_closed_last_12mo != null
                        ? `${m.properties_closed_last_12mo} closed/12mo`
                        : null,
                      m.properties_planned_next_12mo != null
                        ? `${m.properties_planned_next_12mo} planned`
                        : null,
                      m.average_property_value != null
                        ? `avg $${m.average_property_value.toLocaleString()}`
                        : null,
                      m.property_types?.length
                        ? m.property_types.join(", ")
                        : null,
                      m.proposed_tier ? `tier: ${m.proposed_tier}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {m.rejection_reason && (
                    <p className="text-xs text-red-700 mt-1">
                      Rejected: {m.rejection_reason}
                    </p>
                  )}
                  {m.internal_notes && (
                    <p className="text-xs text-ink/55 italic mt-1">
                      {m.internal_notes}
                    </p>
                  )}
                </div>
                <span className="text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border border-gold-soft bg-ivory-strong/40 text-ink/70">
                  {m.status}
                </span>
              </div>

              {m.status === "pending" && (
                <div className="flex flex-col gap-3 border-t border-gold-soft pt-3">
                  <form action={approve} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={m.id} />
                    <input
                      type="text"
                      name="internal_notes"
                      placeholder="Internal notes (optional)"
                      className="border border-gold-soft bg-ivory px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-gold flex-1 min-w-[160px]"
                    />
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-ink text-ivory text-[10px] uppercase tracking-[0.22em]"
                    >
                      Approve
                    </button>
                  </form>
                  <form action={reject} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={m.id} />
                    <input
                      type="text"
                      name="rejection_reason"
                      placeholder="Rejection reason"
                      className="border border-gold-soft bg-ivory px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-gold flex-1 min-w-[160px]"
                    />
                    <button
                      type="submit"
                      className="px-4 py-1.5 border border-red-300 text-red-800 text-[10px] uppercase tracking-[0.22em] hover:bg-red-50 transition-colors"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
