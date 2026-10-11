import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/admin-auth";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createService } from "@/lib/supabase/service";
import {
  AGREEMENT_EXCEPTION_CODES,
  AGREEMENT_EXCEPTION_LABELS,
  AGREEMENT_TYPES,
  AGREEMENT_TYPE_LABELS,
  LEAD_STATUS_LABELS,
  checkTransition,
  isLeadStatus,
  nextStatuses,
} from "@/lib/buyer-leads";

// Cola de la broker para los compradores. La tecnología trae la solicitud; una Realtor
// real la atiende: contacta, verifica representación previa, gestiona el acuerdo y solo
// entonces confirma la visita. La regla "no hay visita confirmada sin acuerdo registrado"
// la aplica también la base (migración 20261011150000).

interface Lead {
  id: string;
  created_at: string;
  source: string;
  status: string;
  legacy_status: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  lang: string | null;
  listing_key: string | null;
  property_id: string | null;
  preferred_times: string | null;
  message: string | null;
  other_agent_status: string | null;
  needs_to_sell: string | null;
  consent_contact_at: string | null;
  consent_marketing_at: string | null;
  consent_version: string | null;
  assigned_agent_id: string | null;
  handled_by_agent_id: string | null;
  agreement_type: string | null;
  agreement_recorded_at: string | null;
  agreement_reference: string | null;
  agreement_exception_code: string | null;
  agreement_note: string | null;
  cancel_reason: string | null;
  notes: string | null;
  budget_min: number | null;
  budget_max: number | null;
  financing_type: string | null;
  timeline: string | null;
}

interface LeadEvent {
  lead_id: string;
  event_type: string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  actor_user_id: string | null;
  created_at: string;
}

const LEAD_COLUMNS =
  "id,created_at,source,status,legacy_status,full_name,email,phone,lang,listing_key,property_id,preferred_times,message,other_agent_status,needs_to_sell,consent_contact_at,consent_marketing_at,consent_version,assigned_agent_id,handled_by_agent_id,agreement_type,agreement_recorded_at,agreement_reference,agreement_exception_code,agreement_note,cancel_reason,notes,budget_min,budget_max,financing_type,timeline";

const VIEWS = ["open", "all", "completed", "cancelled"] as const;
type View = (typeof VIEWS)[number];

const ERRORS: Record<string, string> = {
  invalid_status: "Unknown status.",
  invalid_transition: "That status change is not allowed from the current status.",
  agreement_missing:
    "Record the written agreement before marking the agreement as signed or the showing as confirmed or completed.",
  signed_needs_written: "'Agreement signed' requires a written agreement, not an exception.",
  reason_required: "A reason is required.",
  invalid_agreement: "Choose an agreement type.",
  exception_required:
    "'Not required' needs a reason from the list, and it only applies to Lixtara's own listings. Listings of other brokers always need a written agreement.",
  broker_only: "Only the licensed broker can record buyer agreements.",
  failed: "Could not save. Try again.",
};

const OTHER_AGENT_LABEL: Record<string, string> = {
  exclusive: "Has an EXCLUSIVE agreement with another broker",
  non_exclusive: "Has a non-exclusive agreement with another broker",
  none: "No agreement with another agent",
  unsure: "Not sure about other agreements",
};

const UUID_RE = /^[0-9a-f-]{36}$/i;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York" }) : "—");

// Module scope (ver server-action-closures.test.ts): las server actions solo capturan
// `lang`, nunca una función declarada dentro de la página.
function back(lang: string, leadId: string, extra = ""): string {
  return `/${lang}/admin/buyer-leads?lead=${leadId}${extra}`;
}

async function readLeadForTransition(lang: string, id: string) {
  const sb = await assertStaff(lang);
  const { data } = await sb
    .from("buyer_leads")
    .select("id,status,property_id,agreement_type,agreement_recorded_at,agreement_exception_code")
    .eq("id", id)
    .maybeSingle();
  return { sb, lead: data };
}

export default async function AdminBuyerLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ view?: string; lead?: string; error?: string; done?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "open";
  const focus = sp.lead && UUID_RE.test(sp.lead) ? sp.lead : null;

  const supabase = await createClient();
  let query = supabase.from("buyer_leads").select(LEAD_COLUMNS).order("created_at", { ascending: false }).limit(200);
  if (focus) query = query.eq("id", focus);
  else if (view === "open") query = query.not("status", "in", "(completed,cancelled)");
  else if (view !== "all") query = query.eq("status", view);
  const { data } = await query;
  const leads = (data ?? []) as unknown as Lead[];
  const ids = leads.map((l) => l.id);

  const [{ data: agentRows }, { data: eventRows }] = await Promise.all([
    supabase.from("agent_partners").select("id,name,relationship,brokerage_name").eq("status", "active").order("name"),
    ids.length
      ? supabase
          .from("buyer_lead_events")
          .select("lead_id,event_type,from_value,to_value,note,actor_user_id,created_at")
          .in("lead_id", ids)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);
  const agents = (agentRows ?? []) as Array<{ id: string; name: string; relationship: string; brokerage_name: string | null }>;
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const events = (eventRows ?? []) as LeadEvent[];

  // Qué ficha pidió: propios por dirección; del feed IDX, el número de MLS (lectura de
  // staff con la clave secreta, porque mls_listings es deny-all).
  await assertStaff(lang);
  const svc = createService();
  const ownIds = [...new Set(leads.map((l) => l.property_id).filter((v): v is string => !!v))];
  const mlsKeys = [...new Set(leads.map((l) => l.listing_key).filter((v): v is string => !!v))];
  const [{ data: ownRows }, { data: mlsRows }] = await Promise.all([
    ownIds.length
      ? svc.from("properties").select("id,address_street,address_city").in("id", ownIds)
      : Promise.resolve({ data: [] }),
    mlsKeys.length
      ? svc.from("mls_listings").select("listing_key,listing_id,city").in("listing_key", mlsKeys)
      : Promise.resolve({ data: [] }),
  ]);
  const ownLabel = new Map(
    ((ownRows ?? []) as Array<{ id: string; address_street: string; address_city: string }>).map((r) => [
      r.id,
      `${r.address_street}, ${r.address_city}`,
    ]),
  );
  const mlsLabel = new Map(
    ((mlsRows ?? []) as Array<{ listing_key: string; listing_id: string; city: string | null }>).map((r) => [
      r.listing_key,
      `MLS #${r.listing_id}${r.city ? ` · ${r.city}` : ""}`,
    ]),
  );

  async function changeStatus(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const next = String(formData.get("status") ?? "");
    const reason = String(formData.get("cancel_reason") ?? "").trim().slice(0, 500);
    const { sb, lead } = await readLeadForTransition(lang, id);
    if (!lead) redirect(`/${lang}/admin/buyer-leads?error=failed`);
    const check = checkTransition(lead, next);
    if (!check.ok) redirect(back(lang, id, `&error=${check.error}`));
    if (next === "cancelled" && !reason) redirect(back(lang, id, "&error=reason_required"));
    const { error } = await sb
      .from("buyer_leads")
      .update({
        status: next,
        ...(next === "cancelled" ? { cancel_reason: reason } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    // 23514 = check_violation: la base aplicó la regla aunque la UI la hubiera dejado pasar.
    if (error) redirect(back(lang, id, `&error=${error.code === "23514" ? "agreement_missing" : "failed"}`));
    revalidatePath(`/${lang}/admin/buyer-leads`);
    redirect(back(lang, id, "&done=status"));
  }

  async function recordAgreement(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const type = String(formData.get("agreement_type") ?? "");
    const code = String(formData.get("agreement_exception_code") ?? "");
    const reference = String(formData.get("agreement_reference") ?? "").trim().slice(0, 300);
    const note = String(formData.get("agreement_note") ?? "").trim().slice(0, 500);
    if (!(AGREEMENT_TYPES as readonly string[]).includes(type)) redirect(back(lang, id, "&error=invalid_agreement"));
    const isException = type === "not_required";
    if (isException && !(AGREEMENT_EXCEPTION_CODES as readonly string[]).includes(code)) {
      redirect(back(lang, id, "&error=exception_required"));
    }
    const sb = await assertStaff(lang);
    // La base aplica las reglas de verdad: catálogo + solo listings propios (23514) y solo
    // el rol `broker` puede registrar el acuerdo (42501).
    const { error } = await sb
      .from("buyer_leads")
      .update({
        agreement_type: type,
        agreement_exception_code: isException ? code : null,
        agreement_reference: reference || null,
        agreement_note: note || null,
        agreement_recorded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      const why = error.code === "42501" ? "broker_only" : error.code === "23514" ? "exception_required" : "failed";
      redirect(back(lang, id, `&error=${why}`));
    }
    revalidatePath(`/${lang}/admin/buyer-leads`);
    redirect(back(lang, id, "&done=agreement"));
  }

  async function assign(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const assigned = String(formData.get("assigned_agent_id") ?? "");
    const handled = String(formData.get("handled_by_agent_id") ?? "");
    if ((assigned && !UUID_RE.test(assigned)) || (handled && !UUID_RE.test(handled))) {
      redirect(back(lang, id, "&error=failed"));
    }
    const sb = await assertStaff(lang);
    const { error } = await sb
      .from("buyer_leads")
      .update({
        assigned_agent_id: assigned || null,
        handled_by_agent_id: handled || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) redirect(back(lang, id, "&error=failed"));
    revalidatePath(`/${lang}/admin/buyer-leads`);
    redirect(back(lang, id, "&done=assigned"));
  }

  async function saveNotes(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const sb = await assertStaff(lang);
    await sb
      .from("buyer_leads")
      .update({
        notes: String(formData.get("notes") ?? "").slice(0, 4000).trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    revalidatePath(`/${lang}/admin/buyer-leads`);
    redirect(back(lang, id, "&done=notes"));
  }

  const small = "text-[10px] uppercase tracking-[0.18em] text-ink/55";
  const control =
    "border border-gold-soft bg-ivory px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-gold";
  const btn =
    "px-4 py-1.5 border border-gold-soft text-[10px] uppercase tracking-[0.22em] text-ink/70 hover:border-gold hover:text-ink transition-colors";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl text-ink font-normal">Buyer Leads</h1>
        <p className="text-sm text-ink/60 max-w-2xl">
          Showing requests are not confirmed showings. Contact the buyer, verify prior
          representation and record the written agreement before confirming any tour.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={`/${lang}/admin/buyer-leads?view=${v}`}
            className={`px-3 py-2 text-[10px] uppercase tracking-[0.18em] border transition-colors ${
              !focus && view === v ? "border-gold bg-gold/10 text-ink" : "border-gold-soft text-ink/60 hover:border-gold/60"
            }`}
          >
            {v}
          </Link>
        ))}
      </div>

      {sp.error && ERRORS[sp.error] && (
        <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {ERRORS[sp.error]} Nothing was changed.
        </div>
      )}
      {sp.done && (
        <div className="border border-gold bg-gold/5 px-4 py-3 text-sm text-ink">Saved.</div>
      )}

      {leads.length === 0 ? (
        <p className="text-sm text-ink/55 italic">No buyer leads in this view.</p>
      ) : (
        <ul className="flex flex-col gap-5">
          {leads.map((l) => {
            const statusLabel = isLeadStatus(l.status) ? LEAD_STATUS_LABELS[l.status] : `Legacy: ${l.status}`;
            const moves = nextStatuses(l.status);
            const target = l.property_id
              ? ownLabel.get(l.property_id) ?? "Lixtara listing (no longer active)"
              : l.listing_key
                ? mlsLabel.get(l.listing_key) ?? `MLS listing ${l.listing_key} (no longer in feed)`
                : "—";
            const leadEvents = events.filter((e) => e.lead_id === l.id);
            return (
              <li key={l.id} className="border border-gold-soft bg-ivory p-5 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex flex-col gap-1">
                    <p className="font-display text-lg text-ink">{l.full_name ?? "Unknown buyer"}</p>
                    <p className="text-xs text-ink/70">
                      {l.email && <a href={`mailto:${l.email}`} className="underline">{l.email}</a>}
                      {l.phone && <> · <a href={`tel:${l.phone}`} className="underline">{l.phone}</a></>}
                      {l.lang && ` · ${l.lang.toUpperCase()}`}
                    </p>
                    <p className="text-xs text-ink/60">
                      {target}
                      {l.property_id && (
                        <> · <Link href={`/${lang}/property/${l.property_id}`} className="underline">view</Link></>
                      )}
                    </p>
                    <p className="text-[11px] text-ink/50">
                      {l.source.replace("_", " ")} · received {fmtDate(l.created_at)}
                      {l.legacy_status ? ` · legacy status: ${l.legacy_status} (pre-2026-10 pipeline)` : ""}
                    </p>
                  </div>
                  <span className="text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border border-gold-soft bg-ivory-strong/40 text-ink/80">
                    {statusLabel}
                  </span>
                </div>

                <div className="grid gap-2 text-sm text-ink/80 md:grid-cols-2">
                  {l.preferred_times && <p><span className={small}>Preferred times </span>{l.preferred_times}</p>}
                  {l.other_agent_status && (
                    <p className={l.other_agent_status === "none" ? "" : "text-amber-800"}>
                      {OTHER_AGENT_LABEL[l.other_agent_status] ?? l.other_agent_status}
                    </p>
                  )}
                  {l.needs_to_sell && l.needs_to_sell !== "no" && (
                    <p className="text-gold">Needs to sell first: {l.needs_to_sell} (possible seller lead)</p>
                  )}
                  {(l.budget_min != null || l.budget_max != null || l.financing_type || l.timeline) && (
                    <p className="text-xs text-ink/60">
                      Budget {l.budget_min ?? "?"} to {l.budget_max ?? "?"}
                      {l.financing_type ? ` · ${l.financing_type}` : ""}
                      {l.timeline ? ` · ${l.timeline}` : ""}
                    </p>
                  )}
                  <p className="text-xs text-ink/60">
                    Contact consent {fmtDate(l.consent_contact_at)} · Marketing{" "}
                    {l.consent_marketing_at ? fmtDate(l.consent_marketing_at) : "no"}
                    {l.consent_version ? ` · text ${l.consent_version}` : ""}
                  </p>
                  {l.cancel_reason && <p className="text-xs text-ink/60">Cancelled: {l.cancel_reason}</p>}
                </div>
                {l.message && <p className="text-sm text-ink/80 whitespace-pre-line border-l-2 border-gold-soft pl-3">{l.message}</p>}

                {/* Acuerdo */}
                <div className="border-t border-gold-soft pt-3 flex flex-col gap-2">
                  <p className={small}>Written agreement · recorded only by the licensed broker</p>
                  <p className="text-sm text-ink/80">
                    {l.agreement_type
                      ? `${AGREEMENT_TYPE_LABELS[l.agreement_type as keyof typeof AGREEMENT_TYPE_LABELS] ?? l.agreement_type} · recorded ${fmtDate(l.agreement_recorded_at)}${l.agreement_reference ? ` · ref ${l.agreement_reference}` : ""}${l.agreement_exception_code ? ` · reason: ${AGREEMENT_EXCEPTION_LABELS[l.agreement_exception_code as keyof typeof AGREEMENT_EXCEPTION_LABELS] ?? l.agreement_exception_code}` : ""}${l.agreement_note ? ` · note: ${l.agreement_note}` : ""}`
                      : "Not recorded. Required before confirming a tour."}
                  </p>
                  <form action={recordAgreement} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={l.id} />
                    <select name="agreement_type" defaultValue={l.agreement_type ?? ""} className={control}>
                      <option value="">Agreement type</option>
                      {AGREEMENT_TYPES.map((a) => (
                        <option key={a} value={a}>{AGREEMENT_TYPE_LABELS[a]}</option>
                      ))}
                    </select>
                    <input name="agreement_reference" placeholder="Reference (envelope, file)" maxLength={300} className={`${control} min-w-[180px]`} />
                    {l.property_id && (
                      <select name="agreement_exception_code" defaultValue={l.agreement_exception_code ?? ""} className={control}>
                        <option value="">Exception reason (only if not required)</option>
                        {AGREEMENT_EXCEPTION_CODES.map((c) => (
                          <option key={c} value={c}>{AGREEMENT_EXCEPTION_LABELS[c]}</option>
                        ))}
                      </select>
                    )}
                    <input name="agreement_note" placeholder="Note (optional)" maxLength={500} className={`${control} min-w-[180px] flex-1`} />
                    <button type="submit" className={btn}>Record</button>
                  </form>
                </div>

                {/* Estado */}
                <div className="border-t border-gold-soft pt-3 flex flex-col gap-2">
                  <p className={small}>Status</p>
                  {moves.length > 0 ? (
                    <form action={changeStatus} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={l.id} />
                      <select name="status" defaultValue="" className={control} required>
                        <option value="" disabled>Move to…</option>
                        {moves.map((s) => (
                          <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                      <input name="cancel_reason" placeholder="Reason (required to cancel)" maxLength={500} className={`${control} flex-1 min-w-[180px]`} />
                      <button type="submit" className={btn}>Update</button>
                    </form>
                  ) : (
                    <p className="text-xs text-ink/55">No further status changes.</p>
                  )}
                </div>

                {/* Responsables */}
                <form action={assign} className="border-t border-gold-soft pt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={l.id} />
                  <label className="flex flex-col gap-1">
                    <span className={small}>Received by</span>
                    <select name="assigned_agent_id" defaultValue={l.assigned_agent_id ?? ""} className={control}>
                      <option value="">Unassigned</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} ({a.relationship.replaceAll("_", " ")})</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={small}>Handled by</span>
                    <select name="handled_by_agent_id" defaultValue={l.handled_by_agent_id ?? ""} className={control}>
                      <option value="">Unassigned</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} ({a.relationship.replaceAll("_", " ")})</option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className={btn}>Save</button>
                </form>

                <form action={saveNotes} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={l.id} />
                  <textarea name="notes" defaultValue={l.notes ?? ""} rows={2} placeholder="Notes" className={`${control} flex-1 min-w-[200px]`} />
                  <button type="submit" className={btn}>Save notes</button>
                </form>

                {leadEvents.length > 0 && (
                  <details className="text-xs text-ink/60">
                    <summary className="cursor-pointer">History ({leadEvents.length})</summary>
                    <ol className="mt-2 flex flex-col gap-1">
                      {leadEvents.map((e, i) => (
                        <li key={i}>
                          {fmtDate(e.created_at)} · {e.event_type.replace("_", " ")}
                          {e.from_value || e.to_value
                            ? `: ${agentName.get(e.from_value ?? "") ?? e.from_value ?? "—"} → ${agentName.get(e.to_value ?? "") ?? e.to_value ?? "—"}`
                            : ""}
                          {e.note ? ` (${e.note})` : ""}
                          {e.actor_user_id ? " · staff" : " · system"}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
