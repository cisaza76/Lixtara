import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

interface SessionRow {
  id: string;
  user_id: string;
  token_id: string | null;
  service_type: string;
  topic: string | null;
  scheduled_date: string | null;
  duration_hours: number | null;
  expert_name: string | null;
  zoom_link: string | null;
  status: string;
  notes: string | null;
}

const STATUSES = [
  "all",
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
] as const;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export default async function AdminConsultationsPage({
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
    .from("consultation_sessions")
    .select(
      "id,user_id,token_id,service_type,topic,scheduled_date,duration_hours,expert_name,zoom_link,status,notes",
    )
    .order("scheduled_date", { ascending: false, nullsFirst: false });
  if (status !== "all") query = query.eq("status", status);
  const { data } = await query;
  const sessions = (data ?? []) as SessionRow[];

  const userIds = Array.from(new Set(sessions.map((s) => s.user_id)));
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

  async function saveDetails(formData: FormData) {
    "use server";
    const sb = await assertStaff();
    await sb
      .from("consultation_sessions")
      .update({
        expert_name: String(formData.get("expert_name") ?? "").trim() || null,
        zoom_link: String(formData.get("zoom_link") ?? "").trim() || null,
        notes: String(formData.get("notes") ?? "").slice(0, 2000).trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(formData.get("id") ?? ""));
    revalidatePath(`/${lang}/admin/consultations`);
  }

  async function setStatus(formData: FormData) {
    "use server";
    const next = String(formData.get("status") ?? "");
    if (!["completed", "cancelled", "no_show"].includes(next)) return;
    const id = String(formData.get("id") ?? "");
    const sb = await assertStaff();
    await sb
      .from("consultation_sessions")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", id);
    // Completing a session burns the hours from its prepaid token.
    if (next === "completed") {
      const { data: sess } = await sb
        .from("consultation_sessions")
        .select("token_id,duration_hours")
        .eq("id", id)
        .maybeSingle();
      if (sess?.token_id) {
        const { data: tok } = await sb
          .from("consultation_tokens")
          .select("hours_used")
          .eq("id", sess.token_id)
          .maybeSingle();
        if (tok) {
          await sb
            .from("consultation_tokens")
            .update({
              hours_used:
                Number(tok.hours_used ?? 0) + Number(sess.duration_hours ?? 0),
            })
            .eq("id", sess.token_id);
        }
      }
    }
    revalidatePath(`/${lang}/admin/consultations`);
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl text-ink font-normal">
        Consultations
      </h1>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/${lang}/admin/consultations?status=${s}`}
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

      {sessions.length === 0 ? (
        <p className="text-sm text-ink/55 italic">No consultation sessions.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="border border-gold-soft bg-ivory p-5 flex flex-col gap-4"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-1">
                  <p className="font-display text-lg text-ink">
                    {s.service_type.replace(/_/g, " ")}
                    {s.topic ? ` — ${s.topic}` : ""}
                  </p>
                  <p className="text-xs text-ink/60">
                    {userName.get(s.user_id) ?? s.user_id.slice(0, 8)}
                    {s.scheduled_date
                      ? ` · ${new Date(s.scheduled_date).toLocaleString(lang)}`
                      : " · unscheduled"}
                    {s.duration_hours ? ` · ${s.duration_hours}h` : ""}
                  </p>
                  {s.zoom_link && (
                    <a
                      href={s.zoom_link}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-gold hover:text-ink transition-colors"
                    >
                      Zoom link →
                    </a>
                  )}
                </div>
                <span className="text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border border-gold-soft bg-ivory-strong/40 text-ink/70">
                  {s.status.replace(/_/g, " ")}
                </span>
              </div>

              {s.status === "scheduled" && (
                <div className="flex flex-col gap-3 border-t border-gold-soft pt-3">
                  <form action={saveDetails} className="flex flex-col gap-2 max-w-xl">
                    <input type="hidden" name="id" value={s.id} />
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        name="expert_name"
                        defaultValue={s.expert_name ?? ""}
                        placeholder="Expert name"
                        className="border border-gold-soft bg-ivory px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-gold flex-1 min-w-[140px]"
                      />
                      <input
                        type="url"
                        name="zoom_link"
                        defaultValue={s.zoom_link ?? ""}
                        placeholder="Zoom link"
                        className="border border-gold-soft bg-ivory px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-gold flex-1 min-w-[140px]"
                      />
                    </div>
                    <textarea
                      name="notes"
                      defaultValue={s.notes ?? ""}
                      rows={2}
                      placeholder="Internal notes"
                      className="border border-gold-soft bg-ivory px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-gold"
                    />
                    <button
                      type="submit"
                      className="self-start px-4 py-1.5 bg-ink text-ivory text-[10px] uppercase tracking-[0.22em]"
                    >
                      Save
                    </button>
                  </form>
                  <div className="flex gap-2">
                    {(["completed", "cancelled", "no_show"] as const).map((st) => (
                      <form key={st} action={setStatus}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="status" value={st} />
                        <button
                          type="submit"
                          className="px-4 py-1.5 border border-gold-soft text-[10px] uppercase tracking-[0.22em] text-ink/70 hover:border-gold hover:text-ink transition-colors"
                        >
                          {st.replace(/_/g, " ")}
                        </button>
                      </form>
                    ))}
                  </div>
                </div>
              )}
              {s.notes && s.status !== "scheduled" && (
                <p className="text-xs text-ink/55 italic border-t border-gold-soft pt-2">
                  {s.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
