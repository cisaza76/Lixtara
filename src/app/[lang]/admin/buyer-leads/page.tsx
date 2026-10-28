import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertStaff, assertStaffWithUser } from "@/lib/admin-auth";
import { recordServerEvent } from "@/lib/analytics.server";
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
  awaitingFirstContact,
  isLeadStatus,
  nextStatuses,
  respondByIso,
  transitionBlockReason,
} from "@/lib/buyer-leads";
import { hasOwnAgent, nbrBlockReason, nbrStatusLine, parseBuyerAgent, showingWaitLabel } from "@/lib/nbr-notice";
import { latestNotices, sendNbrLink } from "@/lib/nbr-notice.server";

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
  buyer_agent_name: string | null;
  buyer_agent_brokerage: string | null;
  buyer_agent_email: string | null;
  buyer_agent_license: string | null;
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
  "id,created_at,source,status,legacy_status,full_name,email,phone,lang,listing_key,property_id,preferred_times,message,other_agent_status,buyer_agent_name,buyer_agent_brokerage,buyer_agent_email,buyer_agent_license,needs_to_sell,consent_contact_at,consent_marketing_at,consent_version,assigned_agent_id,handled_by_agent_id,agreement_type,agreement_recorded_at,agreement_reference,agreement_exception_code,agreement_note,cancel_reason,notes,budget_min,budget_max,financing_type,timeline";

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
  nbr_notice_missing:
    "The buyer has no agent (or isn't sure): they must accept the No Brokerage Relationship notice before the showing is confirmed. Send it from this lead.",
  nbr_buyer_agent_missing: "The buyer has an agent: record the agent's name, brokerage, email and license before confirming the showing.",
  nbr_email_unverified: "The buyer accepted the NBR notice but hasn't verified their email yet (link in the email with the PDF). The showing stays pending verification.",
  nbr_send_failed: "Could not send the NBR notice. Check the buyer's email and try again.",
  agent_invalid: "Enter the agent's name, brokerage, a valid email and a valid Florida license number (SL or BK plus digits).",
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
  const { sb, userId } = await assertStaffWithUser(lang);
  const { data } = await sb
    .from("buyer_leads")
    .select("id,status,property_id,agreement_type,agreement_recorded_at,agreement_exception_code,other_agent_status,buyer_agent_name,buyer_agent_email")
    .eq("id", id)
    .maybeSingle();
  return { sb, userId, lead: data };
}

/** Aviso NBR de ese lead: aceptado y correo verificado (clave secreta: tabla de solo lectura para staff). */
async function nbrStateOf(leadId: string): Promise<{ acceptedAt: string | null; verifiedAt: string | null }> {
  const n = (await latestNotices(createService(), "lead_id", [leadId])).get(leadId);
  return { acceptedAt: n?.accepted_at ?? null, verifiedAt: n?.email_verified_at ?? null };
}

/** La ficha que pidió el comprador, para el aviso: dirección propia o número de MLS. */
async function listingLabelFor(lead: { property_id: string | null; listing_key: string | null }): Promise<string | null> {
  const svc = createService();
  if (lead.property_id) {
    const { data } = await svc.from("properties").select("address_street,address_city,address_zip").eq("id", lead.property_id).maybeSingle();
    return data ? `${data.address_street}, ${data.address_city} ${data.address_zip}` : null;
  }
  if (lead.listing_key) {
    const { data } = await svc.from("mls_listings").select("listing_id,city").eq("listing_key", lead.listing_key).maybeSingle();
    return data ? `MLS #${data.listing_id}${data.city ? ` · ${data.city}` : ""}` : null;
  }
  return null;
}

interface LouiShowing {
  id: string;
  user_id: string;
  topic: string;
  preferred_time: string | null;
  notes: string | null;
  status: string;
  buyer_agent_status: string | null;
  buyer_agent_name: string | null;
  buyer_agent_brokerage: string | null;
  buyer_agent_email: string | null;
  buyer_agent_license: string | null;
  created_at: string;
}

/** Visitas pedidas por Loui (schedule_requests): las lee y las cambia el staff con la clave secreta. */
async function loadLouiShowings(): Promise<{ rows: LouiShowing[]; emails: Map<string, string> }> {
  const svc = createService();
  const { data } = await svc
    .from("schedule_requests")
    .select("id,user_id,topic,preferred_time,notes,status,buyer_agent_status,buyer_agent_name,buyer_agent_brokerage,buyer_agent_email,buyer_agent_license,created_at")
    .eq("request_type", "showing")
    .in("status", ["pending", "scheduled"])
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as LouiShowing[];
  const emails = new Map<string, string>();
  for (const uid of new Set(rows.map((r) => r.user_id))) {
    const { data: u } = await svc.auth.admin.getUserById(uid);
    if (u.user?.email) emails.set(uid, u.user.email);
  }
  return { rows, emails };
}

/** El trigger guard_showing_nbr rechaza con 23514 y el motivo al principio del mensaje. */
function dbNbrReason(message: string | undefined): "nbr_notice_missing" | "nbr_buyer_agent_missing" | "nbr_email_unverified" | null {
  if (message?.startsWith("nbr_email_unverified")) return "nbr_email_unverified";
  if (message?.startsWith("nbr_notice_missing")) return "nbr_notice_missing";
  if (message?.startsWith("nbr_buyer_agent_missing")) return "nbr_buyer_agent_missing";
  return null;
}

/**
 * Rastro de auditoría de un intento RECHAZADO (por la regla de la app o por la base). La
 * base revierte la escritura rechazada, así que el trigger del historial no la ve: se
 * registra aquí con la clave secreta y el usuario que lo intentó (migración
 * 20261011160000). Nunca hace fallar la acción: si no se puede registrar, se loguea.
 */
async function logRejected(input: {
  leadId: string;
  userId: string;
  from: string | null;
  attempted: string;
  reason: string;
}): Promise<void> {
  if (!UUID_RE.test(input.leadId)) return;
  const { error } = await createService().from("buyer_lead_events").insert({
    lead_id: input.leadId,
    actor_user_id: input.userId,
    event_type: "rejected_attempt",
    from_value: input.from,
    to_value: input.attempted,
    note: input.reason,
  });
  if (error) {
    console.error(JSON.stringify({ event: "buyer_lead_rejected_log_failed", code: error.code, message: error.message }));
  }
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
  // Aviso NBR de cada lead (el aceptado, o el último enviado).
  const nbrByLead = await latestNotices(createService(), "lead_id", ids);
  const louiShowings = focus ? { rows: [] as LouiShowing[], emails: new Map<string, string>() } : await loadLouiShowings();
  const nbrBySchedule = await latestNotices(createService(), "schedule_request_id", louiShowings.rows.map((r) => r.id));
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const events = (eventRows ?? []) as LeadEvent[];
  // Quien mira, ¿es la broker licenciada? Solo ella ve el formulario de acuerdo.
  const { data: viewerIsBroker } = await supabase.rpc("has_role", { _role: "broker" });

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
    const { sb, userId, lead } = await readLeadForTransition(lang, id);
    if (!lead) redirect(`/${lang}/admin/buyer-leads?error=failed`);
    const check = checkTransition(lead, next);
    if (!check.ok) {
      await logRejected({ leadId: id, userId, from: lead.status, attempted: `status:${next}`, reason: check.error });
      redirect(back(lang, id, `&error=${check.error}`));
    }
    // Sin agente: aviso NBR aceptado. Con agente: su nombre y licencia. La base lo exige igual.
    if (next === "showing_confirmed" || next === "completed") {
      const nbr = await nbrStateOf(id);
      const nbrBlock = nbrBlockReason({
        agentStatus: lead.other_agent_status,
        agentName: lead.buyer_agent_name,
        agentEmail: lead.buyer_agent_email,
        nbrAcceptedAt: nbr.acceptedAt,
        emailVerifiedAt: nbr.verifiedAt,
      });
      if (nbrBlock) {
        await logRejected({ leadId: id, userId, from: lead.status, attempted: `status:${next}`, reason: nbrBlock });
        redirect(back(lang, id, `&error=${nbrBlock}`));
      }
    }
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
    if (error) {
      const why = error.code === "23514" ? (dbNbrReason(error.message) ?? "agreement_missing") : "failed";
      if (why !== "failed") {
        await logRejected({ leadId: id, userId, from: lead.status, attempted: `status:${next}`, reason: `db:${why}` });
      }
      redirect(back(lang, id, `&error=${why}`));
    }
    recordServerEvent({ event: "buyer_lead_status_changed", props: { from: lead.status, to: next } });
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
    const { sb, userId } = await assertStaffWithUser(lang);
    const attempted = `agreement:${type}${isException ? `:${code || "none"}` : ""}`;
    // Solo la broker licenciada registra acuerdos. La base lo exige igual (42501); esto
    // evita el viaje y deja el intento en el historial.
    const { data: isBroker } = await sb.rpc("has_role", { _role: "broker" });
    if (isBroker !== true) {
      await logRejected({ leadId: id, userId, from: null, attempted, reason: "broker_only" });
      redirect(back(lang, id, "&error=broker_only"));
    }
    if (isException && !(AGREEMENT_EXCEPTION_CODES as readonly string[]).includes(code)) {
      await logRejected({ leadId: id, userId, from: null, attempted, reason: "exception_required" });
      redirect(back(lang, id, "&error=exception_required"));
    }
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
      if (why !== "failed") await logRejected({ leadId: id, userId, from: null, attempted, reason: `db:${why}` });
      redirect(back(lang, id, `&error=${why}`));
    }
    recordServerEvent({ event: "buyer_agreement_recorded", props: { type } });
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

  // "Take lead": quien lo recibió pasa a atenderlo. Reasignar sigue en "Handled by".
  async function takeLead(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const sb = await assertStaff(lang);
    const { data: lead } = await sb
      .from("buyer_leads")
      .select("assigned_agent_id,handled_by_agent_id")
      .eq("id", id)
      .maybeSingle();
    if (!lead?.assigned_agent_id || lead.handled_by_agent_id) redirect(back(lang, id, "&error=failed"));
    const { error } = await sb
      .from("buyer_leads")
      .update({ handled_by_agent_id: lead.assigned_agent_id, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("handled_by_agent_id", null);
    if (error) redirect(back(lang, id, "&error=failed"));
    revalidatePath(`/${lang}/admin/buyer-leads`);
    redirect(back(lang, id, "&done=taken"));
  }

  // Aviso NBR por enlace al comprador sin agente (F.S. 475.278(4)): lo lee y lo acepta antes
  // de la visita. El correo va al email del lead; en la URL, solo el token.
  async function sendNbr(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!UUID_RE.test(id)) redirect(`/${lang}/admin/buyer-leads?error=failed`);
    const sb = await assertStaff(lang);
    const { data: lead } = await sb
      .from("buyer_leads")
      .select("id,email,full_name,lang,property_id,listing_key,other_agent_status")
      .eq("id", id)
      .maybeSingle();
    if (!lead?.email || hasOwnAgent(lead.other_agent_status)) redirect(back(lang, id, "&error=nbr_send_failed"));
    const sent = await sendNbrLink(createService(), { leadId: id }, {
      email: lead.email,
      name: lead.full_name,
      lang: lead.lang === "es" ? "es" : "en",
      listingLabel: await listingLabelFor(lead),
      propertyId: lead.property_id,
      listingKey: lead.listing_key,
    });
    if (!sent.ok) redirect(back(lang, id, "&error=nbr_send_failed"));
    revalidatePath(`/${lang}/admin/buyer-leads`);
    redirect(back(lang, id, "&done=nbr_sent"));
  }

  // Agente del comprador: nombre, brokerage, correo y licencia. También cuando el comprador
  // dijo "no" o "no estoy seguro" y después declara un acuerdo: pasa a "con agente" (sin aviso
  // NBR) y la visita se coordina con el agente.
  async function saveBuyerAgent(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const kind = String(formData.get("other_agent_status") ?? "");
    const agent = parseBuyerAgent((k) => formData.get(k) as string | null);
    if (!agent || !hasOwnAgent(kind)) redirect(back(lang, id, "&error=agent_invalid"));
    const sb = await assertStaff(lang);
    const { error } = await sb
      .from("buyer_leads")
      .update({
        other_agent_status: kind,
        buyer_agent_name: agent.name,
        buyer_agent_brokerage: agent.brokerage,
        buyer_agent_email: agent.email,
        buyer_agent_license: agent.license,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) redirect(back(lang, id, "&error=failed"));
    revalidatePath(`/${lang}/admin/buyer-leads`);
    redirect(back(lang, id, "&done=agent"));
  }

  // Visita pedida por Loui: mandar el aviso NBR, marcarla programada (con el aviso aceptado o
  // los datos del agente; la base lo exige igual) o cancelarla.
  async function louiShowingAction(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const op = String(formData.get("op") ?? "");
    const home = `/${lang}/admin/buyer-leads`;
    if (!UUID_RE.test(id)) redirect(`${home}?error=failed`);
    await assertStaff(lang);
    const svc = createService();
    const { data: row } = await svc
      .from("schedule_requests")
      .select("id,user_id,topic,request_type,buyer_agent_status,buyer_agent_name,buyer_agent_email")
      .eq("id", id)
      .maybeSingle();
    if (!row || row.request_type !== "showing") redirect(`${home}?error=failed`);
    if (op === "nbr") {
      const { data: u } = await svc.auth.admin.getUserById(row.user_id);
      if (!u.user?.email || hasOwnAgent(row.buyer_agent_status)) redirect(`${home}?error=nbr_send_failed`);
      const name = typeof u.user.user_metadata?.full_name === "string" ? u.user.user_metadata.full_name : null;
      const sent = await sendNbrLink(svc, { scheduleRequestId: id }, { email: u.user.email, name, lang: lang === "es" ? "es" : "en", listingLabel: row.topic });
      redirect(sent.ok ? `${home}?done=nbr_sent` : `${home}?error=nbr_send_failed`);
    }
    if (op === "scheduled") {
      const notices = await latestNotices(svc, "schedule_request_id", [id]);
      const block = nbrBlockReason({
        agentStatus: row.buyer_agent_status,
        agentName: row.buyer_agent_name,
        agentEmail: row.buyer_agent_email,
        nbrAcceptedAt: notices.get(id)?.accepted_at ?? null,
        emailVerifiedAt: notices.get(id)?.email_verified_at ?? null,
      });
      if (block) redirect(`${home}?error=${block}`);
    }
    if (op !== "scheduled" && op !== "cancelled") redirect(`${home}?error=failed`);
    const { error } = await svc.from("schedule_requests").update({ status: op, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) redirect(`${home}?error=${dbNbrReason(error.message) ?? "failed"}`);
    revalidatePath(home);
    redirect(`${home}?done=status`);
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
          Showing requests are not confirmed showings. Lixtara represents the seller. Buyer with an
          agent: coordinate through the agent. Buyer without an agent: the NBR notice must be accepted
          and the email verified. Record the agreement (or its catalog reason) before confirming.
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
                    {awaitingFirstContact(l.status) && (
                      <p className={`text-[11px] ${new Date(respondByIso(l.created_at)) < new Date() ? "text-red-700 font-semibold" : "text-ink/60"}`}>
                        Respond by {fmtDate(respondByIso(l.created_at))} ET (internal target)
                      </p>
                    )}
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

                {/* Aviso NBR (sin agente) o agente del comprador (con agente) */}
                <div data-nbr-status className="border-t border-gold-soft pt-3 flex flex-col gap-2">
                  {(() => {
                    const n = nbrByLead.get(l.id);
                    const block = nbrBlockReason({
                      agentStatus: l.other_agent_status,
                      agentName: l.buyer_agent_name,
                      agentEmail: l.buyer_agent_email,
                      nbrAcceptedAt: n?.accepted_at ?? null,
                      emailVerifiedAt: n?.email_verified_at ?? null,
                    });
                    const wait = showingWaitLabel({ agentStatus: l.other_agent_status, status: l.status, block }, lang);
                    return wait ? (
                      <p data-showing-wait className="text-[10px] uppercase tracking-[0.18em] text-amber-800">{wait}</p>
                    ) : null;
                  })()}
                  {hasOwnAgent(l.other_agent_status) ? (
                    <>
                      <p className={small}>Buyer&apos;s agent · no NBR notice · all communication goes through the agent</p>
                      <p className={`text-sm ${l.buyer_agent_name && l.buyer_agent_email ? "text-ink/80" : "text-amber-800"}`}>
                        {l.buyer_agent_name && l.buyer_agent_email ? (
                          <>
                            {l.buyer_agent_name}
                            {l.buyer_agent_brokerage ? ` · ${l.buyer_agent_brokerage}` : ""} ·{" "}
                            <a href={`mailto:${l.buyer_agent_email}`} className="underline">{l.buyer_agent_email}</a>
                            {l.buyer_agent_license ? ` · FL license ${l.buyer_agent_license}` : ""}
                          </>
                        ) : (
                          "Missing: record the agent's name, brokerage, email and license before confirming the showing."
                        )}
                      </p>
                      <p className="text-[11px] text-ink/55">
                        Lixtara acts for the seller. To confirm, record the agreement as &quot;Not required&quot; with the reason
                        &quot;Buyer represented by their own agent&quot;.
                      </p>
                      <form action={saveBuyerAgent} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={l.id} />
                      <select name="other_agent_status" defaultValue={hasOwnAgent(l.other_agent_status) ? l.other_agent_status! : "exclusive"} className={control}>
                        <option value="exclusive">Exclusive agreement</option>
                        <option value="non_exclusive">Non-exclusive agreement</option>
                      </select>
                      <input name="buyer_agent_name" defaultValue={l.buyer_agent_name ?? ""} placeholder="Agent name" maxLength={120} className={`${control} min-w-[160px]`} />
                      <input name="buyer_agent_brokerage" defaultValue={l.buyer_agent_brokerage ?? ""} placeholder="Brokerage" maxLength={160} className={`${control} min-w-[160px]`} />
                      <input name="buyer_agent_email" type="email" defaultValue={l.buyer_agent_email ?? ""} placeholder="Agent email" maxLength={200} className={`${control} min-w-[180px]`} />
                      <input name="buyer_agent_license" defaultValue={l.buyer_agent_license ?? ""} placeholder="FL license (SL…)" maxLength={20} className={control} />
                      <button type="submit" className={btn}>Save agent</button>
                    </form>
                    </>
                  ) : (
                    <>
                      {(() => {
                        const n = nbrByLead.get(l.id);
                        const line = nbrStatusLine(
                          { agentStatus: l.other_agent_status, acceptedAt: n?.accepted_at ?? null, sentAt: n?.sent_at ?? null, emailVerifiedAt: n?.email_verified_at ?? null },
                          lang,
                        );
                        return (
                          <>
                            <p
                              data-nbr-accepted={n?.accepted_at ? "true" : "false"}
                              data-email-verified={n?.email_verified_at ? "true" : "false"}
                              className={`text-sm ${n?.accepted_at && n.email_verified_at ? "text-emerald-700" : "text-amber-800"}`}
                            >
                              {line}
                              {n?.accepted_at && n.notice_version ? ` · ${n.notice_version}` : ""}
                            </p>
                            {!n?.accepted_at && l.email && (
                              <form action={sendNbr} className="flex items-center gap-2">
                                <input type="hidden" name="id" value={l.id} />
                                <button type="submit" className={btn}>
                                  {n?.sent_at ? "Resend NBR notice" : "Send NBR notice"}
                                </button>
                                <span className="text-[11px] text-ink/55">Required before confirming the showing.</span>
                              </form>
                            )}
                          </>
                        );
                      })()}
                      <details className="text-xs text-ink/70">
                        <summary className="cursor-pointer">The buyer reports an agreement with an agent</summary>
                        <div className="mt-2"><form action={saveBuyerAgent} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={l.id} />
                      <select name="other_agent_status" defaultValue={hasOwnAgent(l.other_agent_status) ? l.other_agent_status! : "exclusive"} className={control}>
                        <option value="exclusive">Exclusive agreement</option>
                        <option value="non_exclusive">Non-exclusive agreement</option>
                      </select>
                      <input name="buyer_agent_name" defaultValue={l.buyer_agent_name ?? ""} placeholder="Agent name" maxLength={120} className={`${control} min-w-[160px]`} />
                      <input name="buyer_agent_brokerage" defaultValue={l.buyer_agent_brokerage ?? ""} placeholder="Brokerage" maxLength={160} className={`${control} min-w-[160px]`} />
                      <input name="buyer_agent_email" type="email" defaultValue={l.buyer_agent_email ?? ""} placeholder="Agent email" maxLength={200} className={`${control} min-w-[180px]`} />
                      <input name="buyer_agent_license" defaultValue={l.buyer_agent_license ?? ""} placeholder="FL license (SL…)" maxLength={20} className={control} />
                      <button type="submit" className={btn}>Save agent</button>
                    </form></div>
                      </details>
                    </>
                  )}
                </div>

                {/* Acuerdo */}
                <div className="border-t border-gold-soft pt-3 flex flex-col gap-2">
                  <p className={small}>Written agreement · recorded only by the licensed broker</p>
                  <p className="text-sm text-ink/80">
                    {l.agreement_type
                      ? `${AGREEMENT_TYPE_LABELS[l.agreement_type as keyof typeof AGREEMENT_TYPE_LABELS] ?? l.agreement_type} · recorded ${fmtDate(l.agreement_recorded_at)}${l.agreement_reference ? ` · ref ${l.agreement_reference}` : ""}${l.agreement_exception_code ? ` · reason: ${AGREEMENT_EXCEPTION_LABELS[l.agreement_exception_code as keyof typeof AGREEMENT_EXCEPTION_LABELS] ?? l.agreement_exception_code}` : ""}${l.agreement_note ? ` · note: ${l.agreement_note}` : ""}`
                      : "Not recorded. Required before confirming a tour."}
                  </p>
                  {viewerIsBroker !== true ? (
                    <p className="text-xs text-ink/55">
                      Only the licensed broker can record agreements. Sign in with the broker account to record one.
                    </p>
                  ) : (
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
                  )}
                </div>

                {/* Estado */}
                <div className="border-t border-gold-soft pt-3 flex flex-col gap-2">
                  <p className={small}>Status</p>
                  {moves.length > 0 ? (
                    <form action={changeStatus} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={l.id} />
                      <select name="status" defaultValue="" className={control} required>
                        <option value="" disabled>Move to…</option>
                        {moves.map((s) => {
                          // Visible pero deshabilitada, con el motivo: evita un clic que siempre falla.
                          const block = transitionBlockReason(l, s);
                          const nbrBlock =
                            s === "showing_confirmed" || s === "completed"
                              ? nbrBlockReason({
                                  agentStatus: l.other_agent_status,
                                  agentName: l.buyer_agent_name,
                                  agentEmail: l.buyer_agent_email,
                                  nbrAcceptedAt: nbrByLead.get(l.id)?.accepted_at ?? null,
                                  emailVerifiedAt: nbrByLead.get(l.id)?.email_verified_at ?? null,
                                })
                              : null;
                          return (
                            <option key={s} value={s} disabled={block !== null || nbrBlock !== null}>
                              {LEAD_STATUS_LABELS[s]}
                              {block === "needs_agreement" ? " (record the written agreement first)" : ""}
                              {block === "needs_written_agreement" ? " (needs a written agreement, not an exception)" : ""}
                              {!block && nbrBlock === "nbr_notice_missing" ? " (NBR notice not accepted yet)" : ""}
                              {!block && nbrBlock === "nbr_buyer_agent_missing" ? " (record the buyer's agent first)" : ""}
                              {!block && nbrBlock === "nbr_email_unverified" ? " (buyer's email not verified yet)" : ""}
                            </option>
                          );
                        })}
                      </select>
                      <input name="cancel_reason" placeholder="Reason (required to cancel)" maxLength={500} className={`${control} flex-1 min-w-[180px]`} />
                      <button type="submit" className={btn}>Update</button>
                    </form>
                  ) : (
                    <p className="text-xs text-ink/55">No further status changes.</p>
                  )}
                </div>

                {/* Responsables */}
                {!l.handled_by_agent_id && l.assigned_agent_id && (
                  <form action={takeLead} className="border-t border-gold-soft pt-3 flex flex-wrap items-center gap-3">
                    <input type="hidden" name="id" value={l.id} />
                    <span className="text-xs text-amber-800">Not taken yet.</span>
                    <button type="submit" className={btn}>Take lead</button>
                  </form>
                )}
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
                          {e.event_type === "rejected_attempt" ? " · REJECTED" : ""}
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

      {!focus && (
        <section data-loui-showings className="flex flex-col gap-3 border-t border-gold-soft pt-6">
          <h2 className="font-display text-xl text-ink font-normal">Showing requests from Loui</h2>
          {louiShowings.rows.length === 0 ? (
            <p className="text-sm text-ink/55 italic">None open.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {louiShowings.rows.map((r) => {
                const n = nbrBySchedule.get(r.id);
                const withAgent = hasOwnAgent(r.buyer_agent_status);
                const block = nbrBlockReason({
                  agentStatus: r.buyer_agent_status,
                  agentName: r.buyer_agent_name,
                  agentEmail: r.buyer_agent_email,
                  nbrAcceptedAt: n?.accepted_at ?? null,
                  emailVerifiedAt: n?.email_verified_at ?? null,
                });
                return (
                  <li key={r.id} data-loui-showing={r.id} className="border border-gold-soft bg-ivory p-4 flex flex-col gap-2 text-sm text-ink/80">
                    <p className="text-ink">
                      {r.topic} · <span className="uppercase text-[10px] tracking-[0.18em]">{r.status}</span>
                    </p>
                    <p className="text-xs text-ink/60">
                      {louiShowings.emails.get(r.user_id) ?? "—"} · requested {fmtDate(r.created_at)}
                      {r.preferred_time ? ` · ${r.preferred_time}` : ""}
                    </p>
                    {r.notes && <p className="text-xs text-ink/70">{r.notes}</p>}
                    {withAgent ? (
                      <p className="text-xs">
                        Buyer&apos;s agent (all communication through them): {r.buyer_agent_name ?? "—"} · {r.buyer_agent_brokerage ?? "—"} ·{" "}
                        {r.buyer_agent_email ?? "—"} · FL license {r.buyer_agent_license ?? "—"}
                      </p>
                    ) : (
                      <p data-nbr-accepted={n?.accepted_at ? "true" : "false"} className={`text-xs ${n?.accepted_at ? "text-emerald-700" : "text-amber-800"}`}>
                        {nbrStatusLine({ agentStatus: r.buyer_agent_status, acceptedAt: n?.accepted_at ?? null, sentAt: n?.sent_at ?? null, emailVerifiedAt: n?.email_verified_at ?? null }, lang)}
                      </p>
                    )}
                    <form action={louiShowingAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      {!withAgent && !n?.accepted_at && (
                        <button type="submit" name="op" value="nbr" className={btn}>
                          {n?.sent_at ? "Resend NBR notice" : "Send NBR notice"}
                        </button>
                      )}
                      {r.status === "pending" && (
                        <button type="submit" name="op" value="scheduled" disabled={block !== null} className={`${btn} disabled:opacity-40`}>
                          Mark scheduled{block === "nbr_notice_missing" ? " (NBR notice not accepted yet)" : block === "nbr_email_unverified" ? " (email not verified)" : block ? " (buyer's agent missing)" : ""}
                        </button>
                      )}
                      <button type="submit" name="op" value="cancelled" className={btn}>Cancel</button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
