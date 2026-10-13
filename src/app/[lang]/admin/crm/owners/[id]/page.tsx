import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, t, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { assertStaffWithUser } from "@/lib/admin-auth";
import { dateTime, label, money, UUID_RE } from "@/lib/crm/format";

interface Owner {
  id: string;
  owner_key: string;
  owner_type: string;
  registered_name: string;
  mail_line1: string | null;
  mail_line2: string | null;
  mail_city: string | null;
  mail_state_country: string | null;
  mail_zip: string | null;
  domicile: string | null;
  is_absentee: boolean;
  is_foreign: boolean;
  is_out_of_state: boolean;
  num_properties: number;
  portfolio_value: number | null;
  score: number | null;
  priority: string | null;
  pilot_group: string | null;
  sunbiz_match: string | null;
  sunbiz_doc: string | null;
  sunbiz_status: string | null;
  sunbiz_filing_type: string | null;
  sunbiz_formed_on: string | null;
  sunbiz_registered_agent: string | null;
  sunbiz_managers: string[] | null;
  email: string | null;
  email_verified_at: string | null;
  phone: string | null;
  dnc_status: string;
  outreach_status: string;
  last_event_at: string | null;
  source: string;
  collected_on: string;
}

interface Ownership {
  crm_properties: {
    id: string;
    county: string;
    folio: string;
    address: string | null;
    unit: string | null;
    city: string | null;
    zip: string | null;
    just_value: number | null;
    year_built: number | null;
    crm_property_signals: Array<{ signal: string }>;
  } | null;
}

interface OutreachEvent {
  id: string;
  event_type: string;
  occurred_at: string;
  step: number | null;
  reply_subject: string | null;
  reply_text: string | null;
}

// mls_status / mls_number and the 'mls_expirado' signal are never selected or shown:
// their source for prospecting is pending the MLS's answer (see CRM_BRIEF.md).
const PROPERTY_SELECT =
  "crm_properties(id,county,folio,address,unit,city,zip,just_value,year_built,crm_property_signals(signal))";
const HIDDEN_SIGNALS = new Set(["mls_expirado"]);

export default async function CrmOwnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang) || !UUID_RE.test(id)) notFound();
  const c = t(lang).crm;
  const o = c.owner;
  const sp = await searchParams;
  const self = `/${lang}/admin/crm/owners/${id}`;

  const supabase = await createClient();
  const { data: owner } = await supabase.from("crm_owners").select("*").eq("id", id).maybeSingle<Owner>();
  if (!owner) notFound();

  const suppressionQuery = (col: "owner_id" | "email", value: string) =>
    supabase.from("crm_suppression").select("reason,channel,created_at").eq(col, value).limit(1).maybeSingle();
  const [{ data: ownerships }, { data: events }, { data: byOwner }, { data: byEmail }] = await Promise.all([
    supabase.from("crm_property_owners").select(PROPERTY_SELECT).eq("owner_id", id).is("valid_to", null),
    supabase
      .from("crm_outreach")
      .select("id,event_type,occurred_at,step,reply_subject,reply_text")
      .eq("owner_id", id)
      .order("occurred_at", { ascending: false })
      .limit(200),
    suppressionQuery("owner_id", id),
    owner.email ? suppressionQuery("email", owner.email) : Promise.resolve({ data: null }),
  ]);
  const properties = ((ownerships ?? []) as unknown as Ownership[])
    .map((x) => x.crm_properties)
    .filter((p): p is NonNullable<Ownership["crm_properties"]> => !!p);
  const history = (events ?? []) as OutreachEvent[];
  const supp = (byOwner ?? byEmail) as { reason: string; channel: string; created_at: string } | null;

  async function suppress(formData: FormData) {
    "use server";
    // Server actions are callable on their own: re-check the role here.
    const { sb, userId } = await assertStaffWithUser(lang);
    if (formData.get("confirm") !== "yes") redirect(`${self}?error=confirm`);
    const { data: row } = await sb.from("crm_owners").select("id,email").eq("id", id).maybeSingle();
    if (!row) redirect(`${self}?error=failed`);
    const { error } = await sb.from("crm_suppression").insert({
      email: row.email,
      owner_id: row.id,
      channel: "all",
      reason: "manual",
      source: `admin:${userId}`,
    });
    // 23505: this owner or this email is already suppressed — the outcome is the same.
    if (error && error.code !== "23505") {
      console.error(JSON.stringify({ event: "crm_suppress_failed", code: error.code }));
      redirect(`${self}?error=failed`);
    }
    redirect(`${self}?done=suppressed`);
  }

  const mailing = [
    owner.mail_line1,
    owner.mail_line2,
    [owner.mail_city, owner.mail_state_country, owner.mail_zip].filter(Boolean).join(", "),
  ].filter(Boolean);
  const flags = [
    owner.is_absentee && o.absentee,
    owner.is_foreign && o.foreign,
    owner.is_out_of_state && o.outOfState,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link href={`/${lang}/admin/crm/owners`} className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-ink">
          ← {o.back}
        </Link>
        <h2 className="font-display text-2xl text-ink">{owner.registered_name}</h2>
        <p className="text-xs text-ink/60">
          {label(c.ownerTypes, owner.owner_type)} · {o.score} {owner.score ?? c.none} · {o.priority}{" "}
          {owner.priority ?? c.none} · {o.pilotGroup} {owner.pilot_group ?? c.none} · {o.status}{" "}
          <strong className="text-ink">{label(c.statuses, owner.outreach_status)}</strong>
        </p>
      </div>

      {sp.done === "suppressed" && (
        <p className="border border-green-300 bg-green-50 px-4 py-2.5 text-sm text-green-800">{o.suppressDone}</p>
      )}
      {sp.error && (
        <p className="border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          {sp.error === "confirm" ? o.suppressNeedsConfirm : o.suppressError}
        </p>
      )}

      <section className="grid gap-6 sm:grid-cols-2">
        <dl className="flex flex-col gap-3 text-sm">
          <Field k={o.mailing} v={mailing.length ? mailing.join(" · ") : c.none} />
          <Field k={o.domicile} v={[owner.domicile, ...flags].filter(Boolean).join(" · ") || c.none} />
          <Field k={c.owners.colPortfolio} v={`${money(lang, owner.portfolio_value)} · ${owner.num_properties} ${c.owners.colProperties.toLowerCase()}`} />
          <Field k={o.source} v={`${owner.source} · ${owner.collected_on}`} />
        </dl>
        <dl className="flex flex-col gap-3 text-sm">
          <Field
            k={o.email}
            v={owner.email ? `${owner.email}${owner.email_verified_at ? "" : ` (${o.emailUnverified})`}` : c.none}
          />
          <Field k={o.phone} v={owner.phone ?? c.none} />
          <Field k={o.dnc} v={owner.dnc_status} />
          <p className="text-xs text-ink/55 leading-snug">{o.noPhoneFlow}</p>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-[11px] uppercase tracking-[0.2em] text-ink/70">{o.propertiesTitle}</h3>
        {properties.length === 0 ? (
          <p className="text-sm text-ink/55 italic">{o.noProperties}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-ink/55 border-b border-gold-soft">
                  <th className="py-2 pr-4">{o.colFolio}</th>
                  <th className="py-2 pr-4">{o.colAddress}</th>
                  <th className="py-2 pr-4 text-right">{o.colValue}</th>
                  <th className="py-2 pr-4 text-right">{o.colYear}</th>
                  <th className="py-2">{o.colSignals}</th>
                </tr>
              </thead>
              <tbody>
                {properties.map((p) => {
                  const signals = p.crm_property_signals
                    .map((s) => s.signal)
                    .filter((s) => !HIDDEN_SIGNALS.has(s));
                  return (
                    <tr key={p.id} className="border-b border-gold-soft/50">
                      <td className="py-2 pr-4 font-mono text-xs">
                        {p.folio}
                        <span className="block font-sans text-ink/50">{p.county}</span>
                      </td>
                      <td className="py-2 pr-4">
                        {[p.address, p.unit].filter(Boolean).join(" ") || c.none}
                        <span className="block text-xs text-ink/50">{[p.city, p.zip].filter(Boolean).join(" ")}</span>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{money(lang, p.just_value)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{p.year_built ?? c.none}</td>
                      <td className="py-2 text-xs">
                        {signals.length ? signals.map((s) => label(o.signals, s)).join(", ") : c.none}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-[11px] uppercase tracking-[0.2em] text-ink/70">{o.sunbizTitle}</h3>
        {owner.sunbiz_match || owner.sunbiz_doc ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Field k={o.sunbizMatch} v={owner.sunbiz_match ?? c.none} />
            <Field k={o.sunbizDoc} v={owner.sunbiz_doc ?? c.none} />
            <Field k={o.sunbizStatus} v={owner.sunbiz_status ?? c.none} />
            <Field k={o.sunbizFilingType} v={owner.sunbiz_filing_type ?? c.none} />
            <Field k={o.sunbizFormedOn} v={owner.sunbiz_formed_on ?? c.none} />
            <Field k={o.sunbizAgent} v={owner.sunbiz_registered_agent ?? c.none} />
            <Field k={o.sunbizManagers} v={owner.sunbiz_managers?.length ? owner.sunbiz_managers.join(" · ") : c.none} />
          </dl>
        ) : (
          <p className="text-sm text-ink/55 italic">{o.sunbizNone}</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-[11px] uppercase tracking-[0.2em] text-ink/70">{o.historyTitle}</h3>
        {history.length === 0 ? (
          <p className="text-sm text-ink/55 italic">{o.historyEmpty}</p>
        ) : (
          <ol className="flex flex-col divide-y divide-gold-soft/50 border-y border-gold-soft/50">
            {history.map((e) => (
              <li key={e.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-ink/60">
                  <strong className="text-ink">{label(c.events, e.event_type)}</strong>
                  <span>{dateTime(lang as Locale, e.occurred_at)}</span>
                  {e.step !== null && <span>{o.colStep} {e.step}</span>}
                </div>
                {e.reply_subject && <p className="mt-1 text-ink/80">{e.reply_subject}</p>}
                {e.reply_text && (
                  <p className="mt-1 whitespace-pre-wrap text-ink/80 leading-snug">{e.reply_text}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-3 border border-gold-soft p-5">
        <h3 className="text-[11px] uppercase tracking-[0.2em] text-ink/70">{o.suppressTitle}</h3>
        {supp ? (
          <p className="text-sm">
            <strong className="text-red-800">{o.suppressed}</strong> · {o.suppressedReason}: {supp.reason} ·{" "}
            {dateTime(lang, supp.created_at)}
          </p>
        ) : (
          <form action={suppress} className="flex flex-col gap-3">
            <p className="text-xs text-ink/60 max-w-2xl">{o.suppressHelp}</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="confirm" value="yes" required />
              {o.suppressConfirm}
            </label>
            <button
              type="submit"
              className="self-start border border-red-700 px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-red-800 hover:bg-red-700 hover:text-white transition-colors"
            >
              {o.suppressButton}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.18em] text-ink/55">{k}</dt>
      <dd className="text-ink">{v}</dd>
    </div>
  );
}
