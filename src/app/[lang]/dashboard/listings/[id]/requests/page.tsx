// Solicitudes del vendedor sobre su listing ya enviado (#134 retiro, #136 cambios).
// Lee con la sesión: RLS solo devuelve el listing y las solicitudes propias.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CHANGEABLE_FIELD_NAMES,
  canRequest,
  type ChangeSet,
  type FieldValue,
  type ListingRequestKind,
  type ListingRequestStatus,
} from "@/lib/listing-requests";
import { FIELD_LABELS, REQUESTS_COPY } from "@/lib/listing-requests-copy";
import { ListingChangeRequestForm, ListingWithdrawalForm } from "@/components/listing-request-forms";

interface RequestRow {
  id: string;
  kind: ListingRequestKind;
  status: ListingRequestStatus;
  changes: ChangeSet;
  reason: string | null;
  review_note: string | null;
  created_at: string;
}

function fmt(v: FieldValue | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  return typeof v === "string" && v.length > 60 ? `${v.slice(0, 57)}…` : String(v);
}

export default async function ListingRequestsPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  const user = await requireUser(lang, `/${lang}/dashboard/listings/${id}/requests`);
  const copy = REQUESTS_COPY[lang];
  const labels = FIELD_LABELS[lang];

  const supabase = await createClient();
  const { data } = await supabase
    .from("properties")
    .select(["id", "owner_id", "mls_status", ...CHANGEABLE_FIELD_NAMES].join(","))
    .eq("id", id)
    .maybeSingle();
  const prop = data as unknown as (Record<string, FieldValue> & { owner_id: string; mls_status: string }) | null;
  if (!prop || prop.owner_id !== user.id) notFound();
  if (prop.mls_status === "draft") redirect(`/${lang}/listing/new?id=${id}&step=3`);

  const { data: reqRows } = await supabase
    .from("listing_requests")
    .select("id,kind,status,changes,reason,review_note,created_at")
    .eq("property_id", id)
    .order("created_at", { ascending: false })
    .limit(20);
  const requests = (reqRows ?? []) as RequestRow[];
  const pending = (k: ListingRequestKind) => requests.some((r) => r.kind === k && r.status === "pending");

  const current = Object.fromEntries(CHANGEABLE_FIELD_NAMES.map((f) => [f, prop[f] ?? null]));
  const dateFmt = new Intl.DateTimeFormat(lang === "es" ? "es-CO" : "en-US", { dateStyle: "medium" });

  return (
    <main className="bg-background text-foreground flex-1 px-6 py-16 lg:py-24">
      <div className="max-w-3xl mx-auto flex flex-col gap-10">
        <div className="flex flex-col gap-3">
          <Link href={`/${lang}/dashboard`} className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold">
            {copy.backToDashboard}
          </Link>
          <h1 className="font-display text-3xl text-ink font-normal">{copy.title}</h1>
          <p className="text-sm text-ink/60">
            {String(prop.address_street)}, {String(prop.address_city)}
          </p>
          <p className="text-sm text-ink/75 leading-relaxed">{copy.intro}</p>
        </div>

        <section className="border border-gold-soft p-6 flex flex-col gap-4">
          <h2 className="text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">{copy.history}</h2>
          {requests.length === 0 ? (
            <p className="text-sm text-ink/55 italic">{copy.noHistory}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {requests.map((r) => (
                <li key={r.id} className="border-t border-gold-soft pt-3 flex flex-col gap-1.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">
                      {r.kind === "change" ? copy.kindChange : copy.kindWithdrawal}
                    </span>
                    <span className="text-[9px] uppercase tracking-[0.18em] px-2 py-0.5 border border-gold-soft text-ink/70">
                      {copy.status[r.status]}
                    </span>
                    <span className="text-xs text-ink/50">{dateFmt.format(new Date(r.created_at))}</span>
                  </div>
                  {r.kind === "change" && (
                    <ul className="text-xs text-ink/70">
                      {Object.entries(r.changes).map(([f, d]) => (
                        <li key={f}>
                          {labels[f as keyof typeof labels] ?? f}: {fmt(d?.old)} → <strong>{fmt(d?.new)}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                  {r.review_note && (
                    <p className="text-xs text-ink/70">
                      {copy.brokerNote}: <em>{r.review_note}</em>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border border-gold-soft p-6 flex flex-col gap-4">
          <h2 className="text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">{copy.changeTitle}</h2>
          {!canRequest("change", prop.mls_status) ? (
            <p className="text-sm text-ink/70">{copy.changeNotAllowed}</p>
          ) : pending("change") ? (
            <p className="text-sm text-ink/70">{copy.pendingExists}</p>
          ) : (
            <ListingChangeRequestForm lang={lang} propertyId={id} current={current} />
          )}
        </section>

        <section className="border border-gold-soft p-6 flex flex-col gap-4">
          <h2 className="text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">{copy.withdrawTitle}</h2>
          {!canRequest("withdrawal", prop.mls_status) ? (
            <p className="text-sm text-ink/70">{copy.withdrawNotAllowed}</p>
          ) : pending("withdrawal") ? (
            <p className="text-sm text-ink/70">{copy.pendingExists}</p>
          ) : (
            <ListingWithdrawalForm lang={lang} propertyId={id} />
          )}
        </section>
      </div>
    </main>
  );
}
