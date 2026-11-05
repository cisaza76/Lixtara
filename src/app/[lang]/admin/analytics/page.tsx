import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { METRIC_PAYMENT_COLUMNS, liveRevenue } from "@/lib/admin-metrics";

function sum(rows: Array<Record<string, unknown>> | null, key: string): number {
  return (rows ?? []).reduce((s, r) => s + Number(r[key] ?? 0), 0);
}

export default async function AdminAnalyticsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const supabase = await createClient();
  const headCount = (
    table: string,
    col: string,
    val: string,
  ) =>
    supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq(col, val);

  const [
    paidPayments,
    { count: totalProps },
    { count: activeProps },
    { count: closedDeals },
    titleFees,
    consultTokens,
    { count: sessionsDone },
    paidReferrals,
    { count: hotLeads },
    { count: photoOrders },
  ] = await Promise.all([
    // Sin datos de prueba: ni listings is_test ni pagos de Stripe en modo de prueba.
    supabase.from("payments").select(METRIC_PAYMENT_COLUMNS).eq("status", "succeeded"),
    supabase.from("properties").select("id", { count: "exact", head: true }).eq("is_test", false),
    headCount("properties", "mls_status", "active").eq("is_test", false),
    supabase
      .from("transactions")
      .select("id,properties!inner(is_test)", { count: "exact", head: true })
      .eq("status", "closed")
      .eq("properties.is_test", false),
    supabase.from("transactions").select("title_referral_fee"),
    supabase.from("consultation_tokens").select("hours_total,hours_used"),
    headCount("consultation_sessions", "status", "completed"),
    supabase.from("referrals").select("reward_amount").eq("reward_paid", true),
    headCount("buyer_leads", "lead_quality", "hot"),
    supabase
      .from("photography_orders")
      .select("id", { count: "exact", head: true }),
  ]);

  const totalRevenue = liveRevenue(paidPayments.data);
  const titleReferral = sum(titleFees.data, "title_referral_fee");
  const hoursSold = sum(consultTokens.data, "hours_total");
  const referralRewards = sum(paidReferrals.data, "reward_amount");

  const cards: { label: string; value: string }[] = [
    { label: "Total Revenue", value: `$${Math.round(totalRevenue).toLocaleString()}` },
    { label: "Active Listings", value: String(activeProps ?? 0) },
    { label: "Total Properties", value: String(totalProps ?? 0) },
    { label: "Closed Deals", value: String(closedDeals ?? 0) },
    { label: "Title Referral Fees", value: `$${Math.round(titleReferral).toLocaleString()}` },
    { label: "Consultation Hours Sold", value: String(hoursSold) },
    { label: "Consultations Completed", value: String(sessionsDone ?? 0) },
    { label: "Referral Rewards Paid", value: `$${Math.round(referralRewards).toLocaleString()}` },
    { label: "Hot Buyer Leads", value: String(hotLeads ?? 0) },
    { label: "Photography Orders", value: String(photoOrders ?? 0) },
  ];

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl text-ink font-normal">Analytics</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="border border-gold-soft bg-ivory p-5 flex flex-col gap-2"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/55">
              {c.label}
            </p>
            <p className="font-display text-3xl text-ink leading-none">
              {c.value}
            </p>
          </div>
        ))}
      </div>

      <p className="text-xs text-ink/45 italic">
        Chat engagement and AI price-recommendation metrics are pending their
        tables (chat_conversations / property_price_recommendations).
      </p>
    </div>
  );
}
