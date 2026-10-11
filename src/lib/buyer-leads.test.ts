import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AGREEMENT_REQUIRED_STATUSES,
  AGREEMENT_TYPES,
  LEAD_STATUSES,
  NEEDS_TO_SELL_OPTIONS,
  OTHER_AGENT_OPTIONS,
  agreementRequirementMet,
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

const form = (over: Record<string, string> = {}) => {
  const base: Record<string, string> = {
    listing_key: "abc123",
    full_name: "Jane Buyer",
    email: "Jane@Example.com",
    other_agent_status: "none",
    consent_contact: "true",
    lang: "es",
  };
  const all = { ...base, ...over };
  return (k: string) => all[k];
};

const noAgreement = { agreement_type: null, agreement_recorded_at: null, agreement_exception_reason: null };
const withAgreement = {
  agreement_type: "showing_agreement",
  agreement_recorded_at: "2026-10-11T10:00:00Z",
  agreement_exception_reason: null,
};

describe("estados: código y base coinciden", () => {
  it("cada estado, tipo de acuerdo y opción del formulario existe en la migración", () => {
    for (const v of [...LEAD_STATUSES, ...AGREEMENT_TYPES, ...OTHER_AGENT_OPTIONS, ...NEEDS_TO_SELL_OPTIONS]) {
      expect(sql, v).toContain(`'${v}'`);
    }
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

  it("`not_required` exige un motivo escrito", () => {
    const base = { agreement_type: "not_required", agreement_recorded_at: "2026-10-11T10:00:00Z" };
    expect(agreementRequirementMet({ ...base, agreement_exception_reason: "  " })).toBe(false);
    expect(agreementRequirementMet({ ...base, agreement_exception_reason: "Open house, seller side" })).toBe(true);
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

  it("honeypot", () => {
    expect(parseShowingRequest(form({ website: "http://spam" }))).toEqual({ ok: false, error: "spam" });
  });

  it("acuerdo exclusivo con otro broker: se registra cancelado con motivo", () => {
    const r = parseShowingRequest(form({ other_agent_status: "exclusive" }));
    expect(r.ok && initialStatusFor(r.data)).toMatchObject({ status: "cancelled" });
    const ok = parseShowingRequest(form());
    expect(ok.ok && initialStatusFor(ok.data)).toEqual({ status: "received", cancelReason: null });
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

  it("no crea políticas para anon ni de INSERT sobre buyer_leads", () => {
    expect(sql).not.toMatch(/create policy[^;]*on public\.buyer_leads[^;]*/i);
    expect(sql).not.toMatch(/\bto anon\b/i);
  });

  it("retira la lectura pública de agent_partners", () => {
    expect(sql).toMatch(/drop policy if exists "agents read active" on public\.agent_partners/i);
  });
});
