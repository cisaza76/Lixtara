import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AGREEMENT_EXCEPTION_CODES,
  AGREEMENT_REQUIRED_STATUSES,
  AGREEMENT_TYPES,
  LEGACY_ONLY_STATUSES,
  LEAD_STATUSES,
  NEEDS_TO_SELL_OPTIONS,
  OTHER_AGENT_OPTIONS,
  INTERNAL_RESPONSE_TARGET_HOURS,
  agreementRequirementMet,
  awaitingFirstContact,
  normalizePhone,
  respondByIso,
  transitionBlockReason,
  checkTransition,
  initialStatusFor,
  nextStatuses,
  parseShowingRequest,
} from "@/lib/buyer-leads";

const MIGRATION = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20261011150000_buyer_leads_showing_requests.sql"),
  "utf8",
);
const sql = MIGRATION.replace(/--.*$/gm, "");
// El motivo `represented_buyer_own_listing` llega en la migración del aviso NBR (28-oct).
const NBR_SQL = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20261029120000_buyer_nbr_notice.sql"),
  "utf8",
).replace(/--.*$/gm, "");

const form = (over: Record<string, string> = {}) => {
  const base: Record<string, string> = {
    listing_key: "abc123",
    full_name: "Jane Buyer",
    email: "Jane@Example.com",
    other_agent_status: "none",
    consent_contact: "true",
    esign_consent: "true",
    nbr_accept: "true",
    lang: "es",
  };
  const all = { ...base, ...over };
  return (k: string) => all[k];
};

const noAgreement = {
  agreement_type: null, agreement_recorded_at: null, agreement_exception_code: null, property_id: null,
};
const withAgreement = {
  agreement_type: "showing_agreement",
  agreement_recorded_at: "2026-10-11T10:00:00Z",
  agreement_exception_code: null,
  property_id: null,
};
const exception = (code: string | null, property_id: string | null) => ({
  agreement_type: "not_required",
  agreement_recorded_at: "2026-10-11T10:00:00Z",
  agreement_exception_code: code,
  property_id,
});

describe("estados: código y base coinciden", () => {
  it("cada estado, tipo de acuerdo y opción del formulario existe en la migración", () => {
    for (const v of [
      ...LEAD_STATUSES, ...LEGACY_ONLY_STATUSES, ...AGREEMENT_TYPES, ...AGREEMENT_EXCEPTION_CODES,
      ...OTHER_AGENT_OPTIONS, ...NEEDS_TO_SELL_OPTIONS,
    ]) {
      expect(sql + NBR_SQL, v).toContain(`'${v}'`);
    }
    // La restricción vigente del catálogo de motivos está en la migración del aviso NBR.
    const rule = NBR_SQL.slice(NBR_SQL.indexOf("add constraint buyer_leads_exception_code_check"));
    for (const c of AGREEMENT_EXCEPTION_CODES) expect(rule.slice(0, 400), c).toContain(`'${c}'`);
  });

  it("la regla de acuerdo de la base cubre exactamente los mismos estados", () => {
    const rule = sql.slice(sql.indexOf("buyer_leads_agreement_before_showing check"));
    for (const s of AGREEMENT_REQUIRED_STATUSES) expect(rule).toContain(`'${s}'`);
    expect(sql).not.toMatch(/not valid/i);
  });
});

describe("regla dura: sin acuerdo registrado no hay visita confirmada", () => {
  it("rechaza confirmar o completar sin acuerdo", () => {
    expect(checkTransition({ status: "showing_coordinating", ...noAgreement }, "showing_confirmed"))
      .toEqual({ ok: false, error: "agreement_missing" });
    expect(checkTransition({ status: "contacted", ...noAgreement }, "agreement_signed"))
      .toEqual({ ok: false, error: "agreement_missing" });
  });

  it("acepta con un acuerdo registrado", () => {
    expect(checkTransition({ status: "showing_coordinating", ...withAgreement }, "showing_confirmed"))
      .toEqual({ ok: true, status: "showing_confirmed" });
  });

  it("`not_required`: solo con motivo de catálogo y solo en listings propios", () => {
    expect(agreementRequirementMet(exception(null, "p1"))).toBe(false);
    expect(agreementRequirementMet(exception("cualquier texto libre", "p1"))).toBe(false);
    expect(agreementRequirementMet(exception("open_house_seller_side", null))).toBe(false);
    expect(agreementRequirementMet(exception("open_house_seller_side", "p1"))).toBe(true);
    expect(agreementRequirementMet(exception("unrepresented_buyer_own_listing", "p1"))).toBe(true);
  });

  it("'acuerdo firmado' no acepta una excepción", () => {
    expect(checkTransition({ status: "contacted", ...exception("open_house_seller_side", "p1") }, "agreement_signed"))
      .toEqual({ ok: false, error: "signed_needs_written" });
    expect(checkTransition({ status: "showing_coordinating", ...exception("open_house_seller_side", "p1") }, "showing_confirmed"))
      .toEqual({ ok: true, status: "showing_confirmed" });
  });

  it("la base aplica el catálogo, el listing propio y el rol de broker", () => {
    expect(sql).toMatch(/buyer_leads_exception_rule check \(\s*case when agreement_type = 'not_required'\s*then agreement_exception_code is not null and property_id is not null/);
    expect(sql).toMatch(/buyer_leads_signed_is_written/);
    expect(sql).toMatch(/has_role\(''broker''\)/);
    expect(sql).toMatch(/before insert or update on public\.buyer_leads/);
  });

  it("ningún estado alcanza 'completada' sin pasar por 'confirmada'", () => {
    const into = LEAD_STATUSES.filter((s) => nextStatuses(s).includes("completed"));
    expect(into).toEqual(["showing_confirmed"]);
  });

  it("rechaza saltos y estados inventados", () => {
    expect(checkTransition({ status: "received", ...withAgreement }, "completed"))
      .toEqual({ ok: false, error: "invalid_transition" });
    expect(checkTransition({ status: "received", ...noAgreement }, "hacked"))
      .toEqual({ ok: false, error: "invalid_status" });
    expect(nextStatuses("completed")).toEqual([]);
  });

  it("filas históricas: conservan su estado y solo se reclasifican a mano al inicio del embudo", () => {
    expect(nextStatuses("closed")).toEqual(["received", "contact_pending", "contacted", "cancelled"]);
    expect(checkTransition({ status: "closed", ...withAgreement }, "completed"))
      .toEqual({ ok: false, error: "invalid_transition" });
    expect(checkTransition({ status: "lost", ...noAgreement }, "cancelled")).toEqual({ ok: true, status: "cancelled" });
    // La migración no las transforma: no hay ningún UPDATE de `status`.
    expect(sql).not.toMatch(/update public\.buyer_leads\s+set status/i);
  });
});

describe("formulario de solicitud de visita", () => {
  it("acepta una solicitud válida y normaliza", () => {
    const r = parseShowingRequest(form());
    expect(r.ok && r.data).toMatchObject({
      target: { kind: "mls", listingKey: "abc123" },
      email: "jane@example.com",
      otherAgentStatus: "none",
      consentMarketing: false,
      lang: "es",
    });
  });

  it("exige consentimiento de contacto", () => {
    expect(parseShowingRequest(form({ consent_contact: "" }))).toEqual({ ok: false, error: "consent" });
  });

  it("exige exactamente una ficha válida", () => {
    expect(parseShowingRequest(form({ listing_key: "" }))).toEqual({ ok: false, error: "target" });
    expect(parseShowingRequest(form({ property_id: "8a4f6d2e-1b3c-4d5e-8f90-112233445566" })))
      .toEqual({ ok: false, error: "target" });
    expect(parseShowingRequest(form({ listing_key: "x'; drop table--" }))).toEqual({ ok: false, error: "target" });
    const own = parseShowingRequest(form({ listing_key: "", property_id: "8a4f6d2e-1b3c-4d5e-8f90-112233445566" }));
    expect(own.ok && own.data.target).toEqual({ kind: "own", propertyId: "8a4f6d2e-1b3c-4d5e-8f90-112233445566" });
  });

  it("rechaza email, teléfono y longitudes inválidos, y opciones fuera de lista", () => {
    expect(parseShowingRequest(form({ email: "nope" }))).toEqual({ ok: false, error: "email" });
    expect(parseShowingRequest(form({ phone: "call me" }))).toEqual({ ok: false, error: "phone" });
    expect(parseShowingRequest(form({ message: "x".repeat(1001) }))).toEqual({ ok: false, error: "too_long" });
    expect(parseShowingRequest(form({ other_agent_status: "maybe" }))).toEqual({ ok: false, error: "required" });
  });

  it("teléfono opcional; si viene, se normaliza a E.164", () => {
    const sin = parseShowingRequest(form());
    expect(sin.ok && sin.data.phone).toBeNull();
    const us = parseShowingRequest(form({ phone: "(786) 210-3562" }));
    expect(us.ok && us.data.phone).toBe("+17862103562");
    expect(normalizePhone("1 786 210 3562")).toBe("+17862103562");
    expect(normalizePhone("+57 300 123 4567")).toBe("+573001234567");
    expect(normalizePhone("210-3562")).toBeNull();
    expect(normalizePhone("+12")).toBeNull();
    expect(normalizePhone("786.210.3562 ext 4")).toBeNull();
  });

  it("dar un teléfono no autoriza marketing", () => {
    const r = parseShowingRequest(form({ phone: "+17862103562" }));
    expect(r.ok && r.data.consentMarketing).toBe(false);
  });

  it("honeypot", () => {
    expect(parseShowingRequest(form({ website: "http://spam" }))).toEqual({ ok: false, error: "spam" });
  });

  it("acuerdo exclusivo: en un listado de Lixtara NO se cancela; en una ficha de otro broker (fase 2) sí", () => {
    const own = parseShowingRequest(form({ listing_key: "", property_id: "8a4f6d2e-1b3c-4d5e-8f90-112233445566", other_agent_status: "exclusive", buyer_agent_name: "Ana Agente", buyer_agent_brokerage: "Acme Realty", buyer_agent_email: "ana@example.com", buyer_agent_license: "SL123456" }));
    expect(own.ok && initialStatusFor(own.data)).toEqual({ status: "received", cancelReason: null });
    const mls = parseShowingRequest(form({ other_agent_status: "exclusive", buyer_agent_name: "Ana Agente", buyer_agent_brokerage: "Acme Realty", buyer_agent_email: "ana@example.com", buyer_agent_license: "SL123456" }));
    expect(mls.ok && initialStatusFor(mls.data)).toMatchObject({ status: "cancelled" });
    const ok = parseShowingRequest(form());
    expect(ok.ok && initialStatusFor(ok.data)).toEqual({ status: "received", cancelReason: null });
  });
});

describe("aviso NBR y agente del comprador (F.S. 475.278(4))", () => {
  it("sin agente o sin saberlo: consentimiento E-SIGN y aviso NBR obligatorios", () => {
    expect(parseShowingRequest(form({ esign_consent: "" }))).toEqual({ ok: false, error: "esign" });
    expect(parseShowingRequest(form({ nbr_accept: "" }))).toEqual({ ok: false, error: "nbr" });
    expect(parseShowingRequest(form({ other_agent_status: "unsure", nbr_accept: "" }))).toEqual({ ok: false, error: "nbr" });
    const ok = parseShowingRequest(form());
    expect(ok.ok && ok.data).toMatchObject({ nbrAccepted: true, buyerAgent: null });
  });

  it("con agente: nombre, brokerage, correo y licencia; sin aviso NBR (aunque llegue marcado)", () => {
    expect(parseShowingRequest(form({ other_agent_status: "non_exclusive" }))).toEqual({ ok: false, error: "agent" });
    expect(parseShowingRequest(form({ other_agent_status: "non_exclusive", buyer_agent_name: "Ana Agente", buyer_agent_brokerage: "Acme Realty", buyer_agent_email: "nope", buyer_agent_license: "SL123456" })))
      .toEqual({ ok: false, error: "agent" });
    const ok = parseShowingRequest(form({
      other_agent_status: "non_exclusive", esign_consent: "", nbr_accept: "",
      buyer_agent_name: " Ana Agente ", buyer_agent_brokerage: "Acme Realty", buyer_agent_email: "Ana@Example.com", buyer_agent_license: "sl 123456",
    }));
    expect(ok.ok && ok.data).toMatchObject({
      buyerAgent: { name: "Ana Agente", brokerage: "Acme Realty", email: "ana@example.com", license: "SL123456" },
      nbrAccepted: false,
    });
  });
});

describe("migración: segura para pegar y sin escrituras públicas", () => {
  it("sin $$ ni corchetes fuera de comentarios", () => {
    expect(sql).not.toMatch(/[$[]/);
  });

  it("el historial no tiene políticas de escritura; solo lectura de staff", () => {
    const policies = [...sql.matchAll(/create policy[^;]*on public\.buyer_lead_events[^;]*;/gi)].map((m) => m[0]);
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/for select/i);
    expect(sql).toMatch(/alter table public\.buyer_lead_events enable row level security/i);
  });

  it("no crea políticas sobre buyer_leads, elimina la del comprador y no concede nada a anon", () => {
    expect(sql).not.toMatch(/create policy[^;]*on public\.buyer_leads[^;]*/i);
    expect(sql).toMatch(/drop policy if exists "buyer leads own" on public\.buyer_leads/i);
    expect(sql).not.toMatch(/\bto anon\b/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
  });

  it("retira la lectura pública de agent_partners", () => {
    expect(sql).toMatch(/drop policy if exists "agents read active" on public\.agent_partners/i);
  });
});

describe("fase 1.1", () => {
  it("opciones deshabilitadas con motivo cuando falta el acuerdo", () => {
    expect(transitionBlockReason(noAgreement, "showing_confirmed")).toBe("needs_agreement");
    expect(transitionBlockReason(noAgreement, "agreement_signed")).toBe("needs_agreement");
    expect(transitionBlockReason(noAgreement, "showing_coordinating")).toBeNull();
    expect(transitionBlockReason(noAgreement, "cancelled")).toBeNull();
    expect(transitionBlockReason(withAgreement, "showing_confirmed")).toBeNull();
    expect(transitionBlockReason(exception("open_house_seller_side", "p1"), "agreement_signed"))
      .toBe("needs_written_agreement");
  });

  it("meta interna de respuesta: 24 h desde la creación; solo antes del primer contacto", () => {
    expect(INTERNAL_RESPONSE_TARGET_HOURS).toBe(24);
    expect(respondByIso("2026-10-11T14:00:00.000Z")).toBe("2026-10-12T14:00:00.000Z");
    expect(awaitingFirstContact("received")).toBe(true);
    expect(awaitingFirstContact("contact_pending")).toBe(true);
    expect(awaitingFirstContact("contacted")).toBe(false);
  });

  it("migración de intentos rechazados: segura para pegar, sin políticas nuevas", () => {
    const m = readFileSync(
      resolve(__dirname, "../../supabase/migrations/20261011160000_buyer_lead_events_rejected_attempts.sql"),
      "utf8",
    ).replace(/--.*$/gm, "");
    expect(m).toContain("'rejected_attempt'");
    for (const t of ["created", "status_changed", "assigned", "handler_changed", "agreement_recorded"]) {
      expect(m).toContain(`'${t}'`);
    }
    expect(m).not.toMatch(/[$[]/);
    expect(m).not.toMatch(/create policy|grant/i);
  });
});

