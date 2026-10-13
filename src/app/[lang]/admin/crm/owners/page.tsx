import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { applySegment, parseSegment, segmentSelect, segmentToSearchParams } from "@/lib/crm/segment";
import { dateTime, fill, label, money } from "@/lib/crm/format";
import { CrmSegmentFields } from "@/components/admin/crm-segment-fields";

const PAGE_SIZE = 50;

interface OwnerRow {
  id: string;
  registered_name: string;
  owner_type: string;
  num_properties: number;
  portfolio_value: number | null;
  priority: string | null;
  score: number | null;
  outreach_status: string;
  last_event_at: string | null;
  email: string | null;
}

const COLUMNS =
  "id,registered_name,owner_type,num_properties,portfolio_value,priority,score,outreach_status,last_event_at,email";

export default async function CrmOwnersPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const c = t(lang).crm;
  const sp = await searchParams;
  const seg = parseSegment(sp);
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);

  // Session client: RLS (is_crm_admin) decides what this staff member sees.
  const supabase = await createClient();
  const { data, count, error } = await applySegment(
    supabase.from("crm_owners").select(segmentSelect(COLUMNS, seg), { count: "exact" }),
    seg,
  )
    .order("score", { ascending: false, nullsFirst: false })
    .order("id")
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  const owners = (data ?? []) as unknown as OwnerRow[];
  const total = count ?? 0;

  const pageHref = (p: number) => {
    const q = segmentToSearchParams(seg);
    if (p > 0) q.set("page", String(p));
    const s = q.toString();
    return `/${lang}/admin/crm/owners${s ? `?${s}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-ink/60 max-w-3xl">{c.owners.intro}</p>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <CrmSegmentFields c={c} value={seg} />
        <button
          type="submit"
          className="bg-ink px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-ivory hover:bg-gold transition-colors"
        >
          {c.filters.apply}
        </button>
        <Link
          href={`/${lang}/admin/crm/owners`}
          className="px-2 py-2 text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-ink"
        >
          {c.filters.clear}
        </Link>
      </form>

      {error && (
        <p className="border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800">{c.loadError}</p>
      )}

      {!error && owners.length === 0 ? (
        <p className="text-sm text-ink/55 italic">{c.owners.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-ink/55 border-b border-gold-soft">
                <th className="py-3 pr-4">{c.owners.colName}</th>
                <th className="py-3 pr-4">{c.owners.colType}</th>
                <th className="py-3 pr-4 text-right">{c.owners.colProperties}</th>
                <th className="py-3 pr-4 text-right">{c.owners.colPortfolio}</th>
                <th className="py-3 pr-4">{c.owners.colPriority}</th>
                <th className="py-3 pr-4 text-right">{c.owners.colScore}</th>
                <th className="py-3 pr-4">{c.owners.colStatus}</th>
                <th className="py-3">{c.owners.colLastEvent}</th>
              </tr>
            </thead>
            <tbody>
              {owners.map((o) => (
                <tr key={o.id} className="border-b border-gold-soft/50">
                  <td className="py-3 pr-4">
                    <Link href={`/${lang}/admin/crm/owners/${o.id}`} className="text-ink hover:text-gold">
                      {o.registered_name}
                    </Link>
                    {o.email && <span className="block text-xs text-ink/50">{o.email}</span>}
                  </td>
                  <td className="py-3 pr-4 text-ink/80">{label(c.ownerTypes, o.owner_type)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{o.num_properties}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{money(lang, o.portfolio_value)}</td>
                  <td className="py-3 pr-4">{o.priority ?? c.none}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{o.score ?? c.none}</td>
                  <td className="py-3 pr-4 text-xs whitespace-nowrap">{label(c.statuses, o.outreach_status)}</td>
                  <td className="py-3 text-xs text-ink/70 whitespace-nowrap">
                    {o.last_event_at ? dateTime(lang, o.last_event_at) : c.never}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-ink/60">
          <span>
            {fill(c.owners.showing, {
              from: page * PAGE_SIZE + 1,
              to: Math.min(total, (page + 1) * PAGE_SIZE),
              total,
            })}
          </span>
          <span className="flex gap-4">
            {page > 0 && <Link href={pageHref(page - 1)} className="hover:text-ink">{c.owners.prev}</Link>}
            {(page + 1) * PAGE_SIZE < total && (
              <Link href={pageHref(page + 1)} className="hover:text-ink">{c.owners.next}</Link>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
