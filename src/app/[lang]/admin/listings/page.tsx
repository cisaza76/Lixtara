import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

interface ListingRow {
  id: string;
  address_street: string;
  address_city: string;
  address_state: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  list_price: number | null;
  mls_status: string;
  pricing_tier: string | null;
}

const STATUSES = [
  "all",
  "draft",
  "pending_approval",
  "active",
  "under_contract",
  "closed",
  "expired",
  "withdrawn",
] as const;
const TIERS = ["all", "essentials", "pro", "concierge"] as const;

const STATUS_BADGE: Record<string, string> = {
  draft: "border-gold-soft bg-ivory-strong/40 text-ink/60",
  pending_approval: "border-orange-300 bg-orange-50 text-orange-800",
  active: "border-gold bg-gold/5 text-ink",
  under_contract: "border-blue-300 bg-blue-50 text-blue-800",
  closed: "border-green-300 bg-green-50 text-green-800",
  expired: "border-red-300 bg-red-50 text-red-800",
  withdrawn: "border-red-300 bg-red-50 text-red-800",
};

export default async function AdminListingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ status?: string; tier?: string; q?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number])
    ? (sp.status as string)
    : "all";
  const tier = TIERS.includes(sp.tier as (typeof TIERS)[number])
    ? (sp.tier as string)
    : "all";
  const q = (sp.q ?? "").trim();

  const supabase = await createClient();
  let query = supabase
    .from("properties")
    .select(
      "id,address_street,address_city,address_state,bedrooms,bathrooms,sqft,list_price,mls_status,pricing_tier",
    )
    .order("updated_at", { ascending: false })
    .limit(200);
  if (status !== "all") query = query.eq("mls_status", status);
  if (tier !== "all") query = query.eq("pricing_tier", tier);
  if (q) query = query.ilike("address_street", `%${q}%`);
  const { data } = await query;
  const listings = (data ?? []) as ListingRow[];

  const hrefWith = (next: { status?: string; tier?: string }) => {
    const s = next.status ?? status;
    const t = next.tier ?? tier;
    const parts = [`status=${s}`, `tier=${t}`];
    if (q) parts.push(`q=${encodeURIComponent(q)}`);
    return `/${lang}/admin/listings?${parts.join("&")}`;
  };

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl text-ink font-normal">Listings</h1>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={hrefWith({ status: s })}
              className={`px-3 py-2 text-[10px] uppercase tracking-[0.18em] border transition-colors ${
                status === s
                  ? "border-gold bg-gold/10 text-ink"
                  : "border-gold-soft text-ink/60 hover:border-gold/60"
              }`}
            >
              {s.replace("_", " ")}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex flex-wrap gap-2">
            {TIERS.map((t) => (
              <Link
                key={t}
                href={hrefWith({ tier: t })}
                className={`px-3 py-1 text-[10px] uppercase tracking-[0.18em] rounded-full border transition-colors ${
                  tier === t
                    ? "border-gold bg-gold/10 text-ink"
                    : "border-gold-soft text-ink/55 hover:border-gold/60"
                }`}
              >
                {t}
              </Link>
            ))}
          </div>
          <form action={`/${lang}/admin/listings`} className="flex gap-2 ml-auto">
            <input type="hidden" name="status" value={status} />
            <input type="hidden" name="tier" value={tier} />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search address…"
              className="border border-gold-soft bg-ivory px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-gold"
            />
            <button
              type="submit"
              className="px-4 py-1.5 bg-ink text-ivory text-[10px] uppercase tracking-[0.22em]"
            >
              Search
            </button>
          </form>
        </div>
      </div>

      {listings.length === 0 ? (
        <p className="text-sm text-ink/55 italic">No listings match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-ink/55 border-b border-gold-soft">
                <th className="py-3 pr-4">Address</th>
                <th className="py-3 pr-4">Beds/Baths/Sqft</th>
                <th className="py-3 pr-4">Price</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Tier</th>
                <th className="py-3" />
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => (
                <tr key={l.id} className="border-b border-gold-soft/50">
                  <td className="py-3 pr-4">
                    <span className="text-ink">{l.address_street}</span>
                    <span className="block text-xs text-ink/55">
                      {l.address_city}, {l.address_state}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-ink/70 text-xs whitespace-nowrap">
                    {l.bedrooms ?? "—"} / {l.bathrooms ?? "—"} /{" "}
                    {l.sqft ? l.sqft.toLocaleString() : "—"}
                  </td>
                  <td className="py-3 pr-4 font-display text-ink whitespace-nowrap">
                    {l.list_price
                      ? `$${l.list_price.toLocaleString()}`
                      : "—"}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-block text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border ${STATUS_BADGE[l.mls_status] ?? STATUS_BADGE.draft}`}
                    >
                      {l.mls_status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-xs text-ink/70">
                    {l.pricing_tier
                      ? l.pricing_tier.charAt(0).toUpperCase() +
                        l.pricing_tier.slice(1)
                      : "—"}
                  </td>
                  <td className="py-3">
                    <Link
                      href={`/${lang}/admin/listings/${l.id}/review`}
                      className="text-[10px] uppercase tracking-[0.22em] text-gold hover:text-ink transition-colors whitespace-nowrap"
                    >
                      Review →
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
