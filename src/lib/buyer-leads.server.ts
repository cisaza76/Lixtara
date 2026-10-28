// Buyer leads, lado servidor: interruptor, broker de registro, ficha y creación del lead.
//
// INTERRUPTOR (fail-closed): `BUYER_SHOWING_REQUESTS_ENABLED` === "true" abre la solicitud
// al público. Sin él, SOLO el staff (admin/broker) puede usarla, para probar en producción.
// El control está aquí, del lado servidor: la ruta responde 404 y la página no pinta el
// formulario. Ocultar un botón no sería un control.
//
// Fichas del feed IDX: además, la exhibición MLS debe estar permitida en ese host
// (ADR-0013) o quien solicita debe ser staff. Nunca se acepta un listing_key que no sea
// mostrable.
//
// Este módulo NO usa IA ni la alcanza (src/lib/mls/ai-boundary.test.ts lo vigila).
import type { SupabaseClient } from "@supabase/supabase-js";
import { BROKERAGE } from "@/config/brokerage";
import { CONTACT } from "@/config/contact";
import { createClient } from "@/lib/supabase/server";
import { isStaff } from "@/lib/admin-auth";
import { mlsDisplayDecision, readMlsGateEnv } from "@/lib/mls/environment-gate";
import { PUBLIC_DISPLAY_STATUSES } from "@/lib/mls/display-compliance";
import {
  CONSENT_VERSION,
  initialStatusFor,
  type ShowingRequest,
  type ShowingTarget,
} from "@/lib/buyer-leads";

/**
 * Visitas a fichas de OTROS brokers (feed IDX): apagadas para el lanzamiento (decisión del
 * 28-oct), se retoman en la fase 2. Solo el literal "true" las abre, también para el staff.
 */
export function mlsShowingRequestsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.BUYER_SHOWING_REQUESTS_MLS_ENABLED === "true";
}

/** Solo el literal "true" abre la solicitud al público. */
export function showingRequestsPublic(env: Record<string, string | undefined> = process.env): boolean {
  return env.BUYER_SHOWING_REQUESTS_ENABLED === "true";
}

/** ¿Quien hace la petición es admin o broker? Sin sesión, false. */
export async function requesterIsStaff(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  return isStaff(supabase);
}

/** Puede ver y enviar la solicitud: interruptor público abierto, o staff probando. */
export async function canUseShowingRequests(): Promise<{ allowed: boolean; staff: boolean }> {
  const staff = await requesterIsStaff();
  return { allowed: showingRequestsPublic() || staff, staff };
}

/**
 * Id de la broker de registro en el roster (`agent_partners`). La fila se crea la primera
 * vez desde src/config/brokerage.ts, que es la única fuente del nombre y la licencia.
 */
export async function ensureBrokerOfRecord(svc: SupabaseClient): Promise<string> {
  const read = () =>
    svc.from("agent_partners").select("id").eq("relationship", "broker_of_record").maybeSingle();
  const { data: found } = await read();
  if (found?.id) return found.id as string;

  const { data: created, error } = await svc
    .from("agent_partners")
    .insert({
      name: BROKERAGE.brokerName,
      email: CONTACT.inboxEmail,
      phone: CONTACT.phoneE164,
      license_number: BROKERAGE.brokerLicense,
      brokerage_name: BROKERAGE.legalName,
      brokerage_license: BROKERAGE.brokerageLicense,
      relationship: "broker_of_record",
      status: "active",
    })
    .select("id")
    .single();
  if (created?.id) return created.id as string;

  // Carrera con otra solicitud simultánea: el índice único la rechazó; releer.
  const { data: again } = await read();
  if (again?.id) return again.id as string;
  throw new Error(`no se pudo crear la broker de registro: ${error?.message ?? "desconocido"}`);
}

export interface ResolvedTarget {
  /** Para el email interno de la broker. Para fichas MLS: solo el número de MLS. */
  label: string;
  /** Dirección propia (solo listings de Lixtara); null para fichas del feed. */
  ownAddress: string | null;
}

/** La ficha existe y se puede mostrar. null = no aceptar la solicitud. */
export async function resolveTarget(
  svc: SupabaseClient,
  target: ShowingTarget,
  opts: { host: string | null; staff: boolean },
): Promise<ResolvedTarget | null> {
  if (target.kind === "own") {
    const { data } = await svc
      .from("properties")
      .select("id,address_street,address_city,address_zip")
      .eq("id", target.propertyId)
      .eq("mls_status", "active")
      .eq("is_test", false)
      .maybeSingle();
    if (!data) return null;
    const address = `${data.address_street}, ${data.address_city} ${data.address_zip}`;
    return { label: address, ownAddress: address };
  }

  if (!opts.staff && !mlsDisplayDecision(opts.host, readMlsGateEnv()).allowed) return null;
  const { data } = await svc
    .from("mls_listings")
    .select("listing_key,listing_id,city")
    .eq("listing_key", target.listingKey)
    .is("withdrawn_at", null)
    .in("mls_status", [...PUBLIC_DISPLAY_STATUSES])
    .maybeSingle();
  if (!data) return null;
  // Para la broker: número de MLS y ciudad. La dirección completa se consulta en Matrix o en
  // la cola (contenido licenciado; qué puede ir por email está pendiente de MIAMI, P3).
  return { label: `MLS #${data.listing_id}${data.city ? ` · ${data.city}` : ""}`, ownAddress: null };
}

/**
 * Inserta el lead RECIBIDO por la broker de registro. "Atendido por" queda vacío hasta que
 * alguien lo toma desde la cola (botón "Take lead").
 */
export async function insertShowingLead(
  svc: SupabaseClient,
  req: ShowingRequest,
  brokerId: string,
): Promise<{ id: string; status: string; createdAt: string }> {
  const { status, cancelReason } = initialStatusFor(req);
  const now = new Date().toISOString();
  const { data, error } = await svc
    .from("buyer_leads")
    .insert({
      source: "showing_request",
      status,
      cancel_reason: cancelReason,
      full_name: req.fullName,
      email: req.email,
      phone: req.phone,
      preferred_times: req.preferredTimes,
      message: req.message,
      other_agent_status: req.otherAgentStatus,
      buyer_agent_name: req.buyerAgent?.name ?? null,
      buyer_agent_brokerage: req.buyerAgent?.brokerage ?? null,
      buyer_agent_email: req.buyerAgent?.email ?? null,
      buyer_agent_license: req.buyerAgent?.license ?? null,
      needs_to_sell: req.needsToSell,
      lang: req.lang,
      listing_key: req.target.kind === "mls" ? req.target.listingKey : null,
      property_id: req.target.kind === "own" ? req.target.propertyId : null,
      consent_contact_at: now,
      consent_marketing_at: req.consentMarketing ? now : null,
      consent_version: CONSENT_VERSION,
      assigned_agent_id: brokerId,
      handled_by_agent_id: null,
    })
    .select("id,status,created_at")
    .single();
  if (error || !data) throw new Error(`no se pudo crear el lead: ${error?.message ?? "sin datos"}`);
  return { id: data.id as string, status: data.status as string, createdAt: data.created_at as string };
}
