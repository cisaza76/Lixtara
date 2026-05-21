import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

interface OrderRow {
  id: string;
  property_id: string | null;
  user_id: string;
  status: string;
  scheduled_date: string | null;
  time_slot: string | null;
  special_instructions: string | null;
  photographer_name: string | null;
  photographer_phone: string | null;
  amount: number | null;
  photos_delivered_at: string | null;
  properties: { address_street: string; address_city: string } | null;
}

const STATUSES = [
  "all",
  "pending_schedule",
  "scheduled",
  "completed",
  "cancelled",
] as const;
const SLOTS: Record<string, string> = {
  morning: "Morning (8–11)",
  afternoon: "Afternoon (12–3)",
  evening: "Evening (4–7)",
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export default async function AdminPhotographyPage({
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
    .from("photography_orders")
    .select(
      "id,property_id,user_id,status,scheduled_date,time_slot,special_instructions,photographer_name,photographer_phone,amount,photos_delivered_at,properties(address_street,address_city)",
    )
    .order("created_at", { ascending: false });
  if (status !== "all") query = query.eq("status", status);
  const { data } = await query;
  const orders = (data ?? []) as unknown as OrderRow[];

  // Seller contact via service client (users RLS is own-record-only).
  const sellerIds = Array.from(new Set(orders.map((o) => o.user_id)));
  const seller = new Map<
    string,
    { name: string; email: string | null; phone: string | null }
  >();
  const svc = serviceClient();
  if (svc && sellerIds.length > 0) {
    const { data: us } = await svc
      .from("users")
      .select("id,first_name,last_name,email,phone")
      .in("id", sellerIds);
    for (const u of (us ?? []) as Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
    }>) {
      seller.set(u.id, {
        name:
          [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
          u.email ||
          u.id.slice(0, 8),
        email: u.email,
        phone: u.phone,
      });
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

  async function assignPhotographer(formData: FormData) {
    "use server";
    const sb = await assertStaff();
    const id = String(formData.get("id") ?? "");
    await sb
      .from("photography_orders")
      .update({
        photographer_name:
          String(formData.get("photographer_name") ?? "").trim() || null,
        photographer_phone:
          String(formData.get("photographer_phone") ?? "").trim() || null,
        status: "scheduled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    revalidatePath(`/${lang}/admin/photography`);
  }

  async function markCompleted(formData: FormData) {
    "use server";
    const sb = await assertStaff();
    await sb
      .from("photography_orders")
      .update({
        status: "completed",
        photos_delivered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(formData.get("id") ?? ""));
    revalidatePath(`/${lang}/admin/photography`);
  }

  async function cancelOrder(formData: FormData) {
    "use server";
    const sb = await assertStaff();
    await sb
      .from("photography_orders")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", String(formData.get("id") ?? ""));
    revalidatePath(`/${lang}/admin/photography`);
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl text-ink font-normal">Photography</h1>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/${lang}/admin/photography?status=${s}`}
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

      {orders.length === 0 ? (
        <p className="text-sm text-ink/55 italic">No photography orders.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {orders.map((o) => {
            const s = seller.get(o.user_id);
            return (
              <li
                key={o.id}
                className="border border-gold-soft bg-ivory p-5 flex flex-col gap-4"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex flex-col gap-1">
                    <p className="font-display text-lg text-ink">
                      {o.properties
                        ? `${o.properties.address_street}, ${o.properties.address_city}`
                        : "—"}
                    </p>
                    {s && (
                      <p className="text-xs text-ink/60">
                        {s.name}
                        {s.email ? ` · ${s.email}` : ""}
                        {s.phone ? ` · ${s.phone}` : ""}
                      </p>
                    )}
                    <p className="text-xs text-ink/60">
                      {o.scheduled_date
                        ? new Date(o.scheduled_date).toLocaleDateString(lang)
                        : "Unscheduled"}
                      {o.time_slot ? ` · ${SLOTS[o.time_slot] ?? o.time_slot}` : ""}
                      {o.amount != null ? ` · $${o.amount}` : ""}
                    </p>
                    {o.special_instructions && (
                      <p className="text-xs text-ink/55 italic mt-1">
                        “{o.special_instructions}”
                      </p>
                    )}
                  </div>
                  <span className="text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border border-gold-soft bg-ivory-strong/40 text-ink/70">
                    {o.status.replace(/_/g, " ")}
                  </span>
                </div>

                {o.status !== "cancelled" && o.status !== "completed" && (
                  <div className="flex flex-col gap-3 border-t border-gold-soft pt-3">
                    <form
                      action={assignPhotographer}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="id" value={o.id} />
                      <input
                        type="text"
                        name="photographer_name"
                        defaultValue={o.photographer_name ?? ""}
                        placeholder="Photographer name"
                        className="border border-gold-soft bg-ivory px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-gold"
                      />
                      <input
                        type="text"
                        name="photographer_phone"
                        defaultValue={o.photographer_phone ?? ""}
                        placeholder="Phone"
                        className="border border-gold-soft bg-ivory px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-gold"
                      />
                      <button
                        type="submit"
                        className="px-4 py-1.5 bg-ink text-ivory text-[10px] uppercase tracking-[0.22em]"
                      >
                        Assign
                      </button>
                    </form>
                    <div className="flex gap-2">
                      <form action={markCompleted}>
                        <input type="hidden" name="id" value={o.id} />
                        <button
                          type="submit"
                          className="px-4 py-1.5 border border-gold-soft text-[10px] uppercase tracking-[0.22em] text-ink/70 hover:border-gold hover:text-ink transition-colors"
                        >
                          Mark completed
                        </button>
                      </form>
                      <form action={cancelOrder}>
                        <input type="hidden" name="id" value={o.id} />
                        <button
                          type="submit"
                          className="px-4 py-1.5 border border-red-300 text-[10px] uppercase tracking-[0.22em] text-red-800 hover:bg-red-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
