import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

interface TxRow {
  id: string;
  purchase_price: number | null;
  closing_date: string | null;
  status: string;
  buyer_id: string | null;
  properties: { address_street: string; address_city: string } | null;
}

const STATUSES = [
  "all",
  "opened",
  "under_contract",
  "contingencies_pending",
  "clear_to_close",
  "closed",
  "cancelled",
] as const;

const STATUS_BADGE: Record<string, string> = {
  opened: "border-gold-soft bg-ivory-strong/40 text-ink/70",
  under_contract: "border-blue-300 bg-blue-50 text-blue-800",
  contingencies_pending: "border-orange-300 bg-orange-50 text-orange-800",
  clear_to_close: "border-gold bg-gold/5 text-ink",
  closed: "border-green-300 bg-green-50 text-green-800",
  cancelled: "border-red-300 bg-red-50 text-red-800",
};

export default async function AdminTransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const filter = STATUSES.includes(sp.filter as (typeof STATUSES)[number])
    ? (sp.filter as string)
    : "all";

  const supabase = await createClient();
  let query = supabase
    .from("transactions")
    .select(
      "id,purchase_price,closing_date,status,buyer_id,properties(address_street,address_city)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter !== "all") query = query.eq("status", filter);
  const { data } = await query;
  const txs = (data ?? []) as unknown as TxRow[];

  // Buyer names.
  const buyerIds = Array.from(
    new Set(txs.map((t) => t.buyer_id).filter(Boolean) as string[]),
  );
  const buyerName = new Map<string, string>();
  if (buyerIds.length > 0) {
    const { data: buyers } = await supabase
      .from("users")
      .select("id,first_name,last_name,email")
      .in("id", buyerIds);
    for (const b of (buyers ?? []) as Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    }>) {
      buyerName.set(
        b.id,
        [b.first_name, b.last_name].filter(Boolean).join(" ").trim() ||
          b.email ||
          b.id.slice(0, 8),
      );
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl text-ink font-normal">
        Transactions
      </h1>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/${lang}/admin/transactions?filter=${s}`}
            className={`px-3 py-2 text-[10px] uppercase tracking-[0.18em] border transition-colors ${
              filter === s
                ? "border-gold bg-gold/10 text-ink"
                : "border-gold-soft text-ink/60 hover:border-gold/60"
            }`}
          >
            {s.replace(/_/g, " ")}
          </Link>
        ))}
      </div>

      {txs.length === 0 ? (
        <p className="text-sm text-ink/55 italic">
          No transactions match this filter.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-ink/55 border-b border-gold-soft">
                <th className="py-3 pr-4">Property</th>
                <th className="py-3 pr-4">Buyer</th>
                <th className="py-3 pr-4">Purchase price</th>
                <th className="py-3 pr-4">Closing</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3" />
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id} className="border-b border-gold-soft/50">
                  <td className="py-3 pr-4 text-ink">
                    {t.properties
                      ? `${t.properties.address_street}, ${t.properties.address_city}`
                      : "—"}
                  </td>
                  <td className="py-3 pr-4 text-ink/70">
                    {t.buyer_id ? (buyerName.get(t.buyer_id) ?? "—") : "—"}
                  </td>
                  <td className="py-3 pr-4 font-display text-ink whitespace-nowrap">
                    {t.purchase_price
                      ? `$${t.purchase_price.toLocaleString()}`
                      : "—"}
                  </td>
                  <td className="py-3 pr-4 text-xs text-ink/70 whitespace-nowrap">
                    {t.closing_date
                      ? new Date(t.closing_date).toLocaleDateString(lang)
                      : "—"}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-block text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border ${STATUS_BADGE[t.status] ?? STATUS_BADGE.opened}`}
                    >
                      {t.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="py-3">
                    <Link
                      href={`/${lang}/admin/transactions/${t.id}`}
                      className="text-[10px] uppercase tracking-[0.22em] text-gold hover:text-ink transition-colors"
                    >
                      Open →
                    </Link>
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
