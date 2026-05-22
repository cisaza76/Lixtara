import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

interface Referral {
  id: string;
  referral_code: string | null;
  referrer_id: string | null;
  referred_id: string | null;
  referred_email: string | null;
  status: string;
  reward_amount: number | null;
  reward_paid: boolean;
  created_at: string;
}

const STATUSES = ["all", "pending", "sent", "signed_up", "closed"] as const;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export default async function AdminReferralsPage({
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
    .from("referrals")
    .select(
      "id,referral_code,referrer_id,referred_id,referred_email,status,reward_amount,reward_paid,created_at",
    )
    .order("created_at", { ascending: false });
  if (status !== "all") query = query.eq("status", status);
  const { data } = await query;
  const referrals = (data ?? []) as Referral[];

  const userIds = Array.from(
    new Set(
      referrals
        .flatMap((r) => [r.referrer_id, r.referred_id])
        .filter(Boolean) as string[],
    ),
  );
  const userName = new Map<string, string>();
  const svc = serviceClient();
  if (svc && userIds.length > 0) {
    const { data: us } = await svc
      .from("users")
      .select("id,first_name,last_name,email")
      .in("id", userIds);
    for (const u of (us ?? []) as Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    }>) {
      userName.set(
        u.id,
        [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
          u.email ||
          u.id.slice(0, 8),
      );
    }
  }

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

  async function markPaid(formData: FormData) {
    "use server";
    const sb = await assertStaff();
    await sb
      .from("referrals")
      .update({ reward_paid: true, updated_at: new Date().toISOString() })
      .eq("id", String(formData.get("id") ?? ""));
    revalidatePath(`/${lang}/admin/referrals`);
  }

  async function setStatus(formData: FormData) {
    "use server";
    const next = String(formData.get("status") ?? "");
    if (!["pending", "sent", "signed_up", "closed"].includes(next)) return;
    const sb = await assertStaff();
    await sb
      .from("referrals")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", String(formData.get("id") ?? ""));
    revalidatePath(`/${lang}/admin/referrals`);
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl text-ink font-normal">Referrals</h1>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/${lang}/admin/referrals?status=${s}`}
            className={`px-3 py-2 text-[10px] uppercase tracking-[0.18em] border transition-colors ${
              status === s
                ? "border-gold bg-gold/10 text-ink"
                : "border-gold-soft text-ink/60 hover:border-gold/60"
            }`}
          >
            {s.replace(/_/g, " ")}
          </Link>
        ))}
      </div>

      {referrals.length === 0 ? (
        <p className="text-sm text-ink/55 italic">No referrals yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-ink/55 border-b border-gold-soft">
                <th className="py-3 pr-4">Code</th>
                <th className="py-3 pr-4">Referrer</th>
                <th className="py-3 pr-4">Referred</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Reward</th>
                <th className="py-3 pr-4">Date</th>
                <th className="py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.id} className="border-b border-gold-soft/50 align-top">
                  <td className="py-3 pr-4 font-mono text-xs text-ink/70">
                    {r.referral_code ?? "—"}
                  </td>
                  <td className="py-3 pr-4 text-ink">
                    {r.referrer_id ? (userName.get(r.referrer_id) ?? "—") : "—"}
                  </td>
                  <td className="py-3 pr-4 text-ink/70 text-xs">
                    {r.referred_id
                      ? (userName.get(r.referred_id) ?? r.referred_id.slice(0, 8))
                      : (r.referred_email ?? "—")}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border border-gold-soft bg-ivory-strong/40 text-ink/70">
                      {r.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    ${r.reward_amount ?? 0}
                    {r.reward_paid ? (
                      <span className="ml-2 text-[9px] uppercase tracking-[0.18em] text-green-700">
                        paid
                      </span>
                    ) : (
                      <span className="ml-2 text-[9px] uppercase tracking-[0.18em] text-ink/45">
                        unpaid
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs text-ink/60 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleDateString(lang)}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <form action={setStatus} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={r.id} />
                        <select
                          name="status"
                          defaultValue={r.status}
                          className="border border-gold-soft bg-ivory px-1.5 py-1 text-xs text-ink focus:outline-none focus:border-gold"
                        >
                          {STATUSES.filter((s) => s !== "all").map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="px-2 py-1 border border-gold-soft text-[9px] uppercase tracking-[0.18em] text-ink/70 hover:border-gold"
                        >
                          Set
                        </button>
                      </form>
                      {!r.reward_paid && (
                        <form action={markPaid}>
                          <input type="hidden" name="id" value={r.id} />
                          <button
                            type="submit"
                            className="px-2 py-1 bg-ink text-ivory text-[9px] uppercase tracking-[0.18em] whitespace-nowrap"
                          >
                            Mark paid
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
