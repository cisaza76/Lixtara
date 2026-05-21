import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

interface Agent {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  license_number: string | null;
  specialties: string[] | null;
  service_areas: string[] | null;
  languages: string[] | null;
  years_experience: number | null;
  accepts_rebate_split: boolean;
  bio: string | null;
  status: string;
}

const STATUSES = ["all", "active", "pending", "inactive"] as const;

function csv(v: FormDataEntryValue | null): string[] | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export default async function AdminAgentsPage({
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
    .from("agent_partners")
    .select(
      "id,name,email,phone,license_number,specialties,service_areas,languages,years_experience,accepts_rebate_split,bio,status",
    )
    .order("created_at", { ascending: false });
  if (status !== "all") query = query.eq("status", status);
  const { data } = await query;
  const agents = (data ?? []) as Agent[];

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

  async function createAgent(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    const sb = await assertStaff();
    await sb.from("agent_partners").insert({
      name,
      email: String(formData.get("email") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      license_number: String(formData.get("license_number") ?? "").trim() || null,
      specialties: csv(formData.get("specialties")),
      service_areas: csv(formData.get("service_areas")),
      languages: csv(formData.get("languages")),
      years_experience: formData.get("years_experience")
        ? Number(formData.get("years_experience"))
        : null,
      accepts_rebate_split: formData.get("accepts_rebate_split") === "1",
      bio: String(formData.get("bio") ?? "").trim() || null,
      status: "active",
    });
    revalidatePath(`/${lang}/admin/agents`);
  }

  async function setAgentStatus(formData: FormData) {
    "use server";
    const next = String(formData.get("status") ?? "");
    if (!["active", "inactive", "pending"].includes(next)) return;
    const sb = await assertStaff();
    await sb
      .from("agent_partners")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", String(formData.get("id") ?? ""));
    revalidatePath(`/${lang}/admin/agents`);
  }

  const input =
    "border border-gold-soft bg-ivory px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-gold";

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl text-ink font-normal">
        Partner Agents
      </h1>

      {/* New agent */}
      <details className="border border-gold-soft p-5">
        <summary className="cursor-pointer text-[10px] uppercase tracking-[0.22em] text-gold font-semibold">
          + Add a partner agent
        </summary>
        <form action={createAgent} className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          <input name="name" required placeholder="Name" className={input} />
          <input name="email" type="email" placeholder="Email" className={input} />
          <input name="phone" placeholder="Phone" className={input} />
          <input name="license_number" placeholder="License #" className={input} />
          <input name="specialties" placeholder="Specialties (comma-separated)" className={input} />
          <input name="service_areas" placeholder="Service areas (comma-separated)" className={input} />
          <input name="languages" placeholder="Languages (comma-separated)" className={input} />
          <input name="years_experience" type="number" min={0} placeholder="Years experience" className={input} />
          <textarea name="bio" rows={2} placeholder="Bio" className={`${input} md:col-span-2`} />
          <label className="flex items-center gap-2 text-sm text-ink/80">
            <input type="checkbox" name="accepts_rebate_split" value="1" className="accent-gold" />
            Accepts rebate split
          </label>
          <div className="md:col-span-2">
            <button type="submit" className="px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase">
              Add agent
            </button>
          </div>
        </form>
      </details>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/${lang}/admin/agents?status=${s}`}
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

      {agents.length === 0 ? (
        <p className="text-sm text-ink/55 italic">No agents yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {agents.map((ag) => (
            <li key={ag.id} className="border border-gold-soft bg-ivory p-5 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-1">
                  <p className="font-display text-lg text-ink">{ag.name}</p>
                  <p className="text-xs text-ink/60">
                    {[ag.email, ag.phone, ag.license_number ? `Lic ${ag.license_number}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="text-xs text-ink/55">
                    {[
                      ag.years_experience ? `${ag.years_experience} yrs` : null,
                      ag.specialties?.length ? ag.specialties.join(", ") : null,
                      ag.service_areas?.length ? ag.service_areas.join(", ") : null,
                      ag.accepts_rebate_split ? "rebate split ✓" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span className="text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border border-gold-soft bg-ivory-strong/40 text-ink/70">
                  {ag.status}
                </span>
              </div>
              <div className="flex gap-2">
                {(["active", "inactive", "pending"] as const)
                  .filter((s) => s !== ag.status)
                  .map((s) => (
                    <form key={s} action={setAgentStatus}>
                      <input type="hidden" name="id" value={ag.id} />
                      <input type="hidden" name="status" value={s} />
                      <button
                        type="submit"
                        className="px-3 py-1 border border-gold-soft text-[10px] uppercase tracking-[0.18em] text-ink/70 hover:border-gold hover:text-ink transition-colors"
                      >
                        → {s}
                      </button>
                    </form>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
