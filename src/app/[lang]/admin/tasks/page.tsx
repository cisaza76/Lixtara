import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  task_type: string;
  priority: string | null;
  status: string;
  property_id: string | null;
  created_at: string;
  properties: { address_street: string; address_city: string } | null;
}

const STATUSES = ["all", "pending", "in_progress", "completed"] as const;
const PRIORITIES = ["all", "urgent", "high", "medium", "low"] as const;

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "border-red-300 bg-red-50 text-red-800",
  high: "border-orange-300 bg-orange-50 text-orange-800",
  medium: "border-gold bg-gold/5 text-ink",
  low: "border-gold-soft bg-ivory-strong/40 text-ink/60",
};

export default async function AdminTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ status?: string; priority?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number])
    ? (sp.status as string)
    : "all";
  const priority = PRIORITIES.includes(
    sp.priority as (typeof PRIORITIES)[number],
  )
    ? (sp.priority as string)
    : "all";

  const supabase = await createClient();
  let query = supabase
    .from("broker_tasks")
    .select(
      "id,title,description,task_type,priority,status,property_id,created_at,properties(address_street,address_city)",
    )
    .order("created_at", { ascending: false });
  if (status !== "all") query = query.eq("status", status);
  if (priority !== "all") query = query.eq("priority", priority);
  const { data } = await query;
  const tasks = (data ?? []) as unknown as TaskRow[];

  async function markComplete(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    const supabase = await createClient();
    const [{ data: a }, { data: b }] = await Promise.all([
      supabase.rpc("has_role", { _role: "admin" }),
      supabase.rpc("has_role", { _role: "broker" }),
    ]);
    if (a !== true && b !== true) redirect(`/${lang}/dashboard`);
    await supabase
      .from("broker_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", id);
    revalidatePath(`/${lang}/admin/tasks`);
  }

  const tabHref = (s: string) =>
    `/${lang}/admin/tasks?status=${s}${priority !== "all" ? `&priority=${priority}` : ""}`;
  const prHref = (p: string) =>
    `/${lang}/admin/tasks?priority=${p}${status !== "all" ? `&status=${status}` : ""}`;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl text-ink font-normal">Tasks</h1>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={tabHref(s)}
              className={`px-4 py-2 text-[10px] uppercase tracking-[0.18em] border transition-colors ${
                status === s
                  ? "border-gold bg-gold/10 text-ink"
                  : "border-gold-soft text-ink/60 hover:border-gold/60"
              }`}
            >
              {s.replace("_", " ")}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {PRIORITIES.map((p) => (
            <Link
              key={p}
              href={prHref(p)}
              className={`px-3 py-1 text-[10px] uppercase tracking-[0.18em] rounded-full border transition-colors ${
                priority === p
                  ? "border-gold bg-gold/10 text-ink"
                  : "border-gold-soft text-ink/55 hover:border-gold/60"
              }`}
            >
              {p}
            </Link>
          ))}
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-ink/55 italic">
          No tasks match these filters.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {tasks.map((task) => {
            const addr = task.properties
              ? `${task.properties.address_street}, ${task.properties.address_city}`
              : null;
            const reviewable = !!task.property_id;
            return (
              <li
                key={task.id}
                className="border border-gold-soft bg-ivory p-5 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex flex-col gap-1">
                    <p className="font-display text-lg text-ink leading-tight">
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="text-sm text-ink/70 leading-relaxed">
                        {task.description}
                      </p>
                    )}
                    {addr &&
                      (reviewable ? (
                        <Link
                          href={`/${lang}/admin/listings/${task.property_id}/review`}
                          className="text-xs text-gold hover:text-ink transition-colors mt-1"
                        >
                          {addr} →
                        </Link>
                      ) : (
                        <span className="text-xs text-ink/55 mt-1">{addr}</span>
                      ))}
                  </div>
                  <div className="flex items-center gap-2">
                    {task.priority && (
                      <span
                        className={`text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border ${PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.low}`}
                      >
                        {task.priority}
                      </span>
                    )}
                    <span className="text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border border-gold-soft bg-ivory-strong/40 text-ink/70">
                      {task.status.replace("_", " ")}
                    </span>
                  </div>
                </div>
                {task.status === "pending" && (
                  <form action={markComplete} className="self-start">
                    <input type="hidden" name="id" value={task.id} />
                    <button
                      type="submit"
                      className="inline-flex items-center px-5 py-2.5 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
                    >
                      Mark Complete
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
