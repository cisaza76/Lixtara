import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

interface Tx {
  id: string;
  property_id: string;
  purchase_price: number | null;
  earnest_money: number | null;
  closing_date: string | null;
  actual_closing_date: string | null;
  status: string;
  title_company_name: string | null;
  title_company_contact: string | null;
  title_company_email: string | null;
  title_order_number: string | null;
  title_referral_fee: number | null;
  nexxos_flat_fee: number | null;
  nexxos_commission: number | null;
  nexxos_co_broke: number | null;
}

const STATUS_FLOW = [
  "opened",
  "under_contract",
  "contingencies_pending",
  "clear_to_close",
  "closed",
  "cancelled",
];

function money(n: number | null | undefined): string {
  return n != null ? `$${Number(n).toLocaleString()}` : "—";
}

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("transactions")
    .select(
      "id,property_id,purchase_price,earnest_money,closing_date,actual_closing_date,status,title_company_name,title_company_contact,title_company_email,title_order_number,title_referral_fee,nexxos_flat_fee,nexxos_commission,nexxos_co_broke",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const tx = data as Tx;

  const { data: prop } = await supabase
    .from("properties")
    .select("address_street,address_city,address_state,address_zip")
    .eq("id", tx.property_id)
    .maybeSingle();
  const address = prop
    ? `${prop.address_street}, ${prop.address_city}, ${prop.address_state} ${prop.address_zip}`
    : "—";

  async function assertAdmin() {
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

  async function saveTitle(formData: FormData) {
    "use server";
    const sb = await assertAdmin();
    await sb
      .from("transactions")
      .update({
        title_company_name:
          String(formData.get("title_company_name") ?? "").trim() || null,
        title_company_contact:
          String(formData.get("title_company_contact") ?? "").trim() || null,
        title_company_email:
          String(formData.get("title_company_email") ?? "").trim() || null,
        title_order_number:
          String(formData.get("title_order_number") ?? "").trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    revalidatePath(`/${lang}/admin/transactions/${id}`);
  }

  async function setStatus(formData: FormData) {
    "use server";
    const next = String(formData.get("status") ?? "");
    if (!STATUS_FLOW.includes(next)) return;
    const sb = await assertAdmin();
    const patch: Record<string, unknown> = {
      status: next,
      updated_at: new Date().toISOString(),
    };
    if (next === "closed") patch.actual_closing_date = new Date().toISOString();
    await sb.from("transactions").update(patch).eq("id", id);
    revalidatePath(`/${lang}/admin/transactions/${id}`);
  }

  const titleField = (
    name: string,
    label: string,
    value: string | null,
    type = "text",
  ) => (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
        {label}
      </span>
      <input
        type={type}
        name={name}
        defaultValue={value ?? ""}
        className="border border-gold-soft bg-ivory px-3 py-2 text-sm text-ink focus:outline-none focus:border-gold"
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link
          href={`/${lang}/admin/transactions`}
          className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
        >
          ← Transactions
        </Link>
        <h1 className="font-display text-3xl text-ink font-normal">{address}</h1>
        <span className="text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border border-gold bg-gold/5 text-ink self-start">
          {tx.status.replace(/_/g, " ")}
        </span>
      </div>

      {/* Deal facts */}
      <section className="border border-gold-soft p-6 grid grid-cols-2 md:grid-cols-4 gap-5 text-sm">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            Purchase price
          </p>
          <p className="text-ink">{money(tx.purchase_price)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            Earnest money
          </p>
          <p className="text-ink">{money(tx.earnest_money)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            Closing date
          </p>
          <p className="text-ink">
            {tx.closing_date
              ? new Date(tx.closing_date).toLocaleDateString(lang)
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            Closed on
          </p>
          <p className="text-ink">
            {tx.actual_closing_date
              ? new Date(tx.actual_closing_date).toLocaleDateString(lang)
              : "—"}
          </p>
        </div>
      </section>

      {/* Title company */}
      <section className="border border-gold-soft p-6 flex flex-col gap-4">
        <h2 className="font-display text-xl text-ink">Title company</h2>
        <form action={saveTitle} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {titleField("title_company_name", "Company", tx.title_company_name)}
          {titleField(
            "title_company_contact",
            "Contact",
            tx.title_company_contact,
          )}
          {titleField(
            "title_company_email",
            "Email",
            tx.title_company_email,
            "email",
          )}
          {titleField(
            "title_order_number",
            "Order number",
            tx.title_order_number,
          )}
          <div className="md:col-span-2">
            <button
              type="submit"
              className="inline-flex items-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
            >
              Save title info
            </button>
          </div>
        </form>
      </section>

      {/* Revenue */}
      <section className="border border-gold-soft p-6 grid grid-cols-2 md:grid-cols-4 gap-5 text-sm">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            Flat fee
          </p>
          <p className="text-ink">{money(tx.nexxos_flat_fee)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            Commission
          </p>
          <p className="text-ink">{money(tx.nexxos_commission)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            Co-broke
          </p>
          <p className="text-ink">{money(tx.nexxos_co_broke)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            Title referral fee
          </p>
          <p className="text-ink">{money(tx.title_referral_fee)}</p>
        </div>
      </section>

      {/* Status transitions */}
      <section className="border-t-2 border-gold-soft pt-6 flex flex-col gap-3">
        <h2 className="font-display text-xl text-ink">Advance status</h2>
        <div className="flex flex-wrap gap-2">
          {STATUS_FLOW.filter((s) => s !== tx.status).map((s) => (
            <form key={s} action={setStatus}>
              <input type="hidden" name="status" value={s} />
              <button
                type="submit"
                className="px-4 py-2.5 border border-gold-soft text-[10px] uppercase tracking-[0.22em] text-ink/70 hover:border-gold hover:text-ink transition-colors"
              >
                → {s.replace(/_/g, " ")}
              </button>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
