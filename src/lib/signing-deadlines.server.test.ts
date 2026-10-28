// Plazo de firma con dos vendedores (#220), de punta a punta con la base y DocuSign simulados:
// el cron manda cada recordatorio una vez, al vencer anula el sobre y deja el acuerdo "expired"
// con un solo aviso a los dos; la firma del segundo avisa al vendedor una vez.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ agreements: [] as Row[] }));
const ds = vi.hoisted(() => ({
  envelope: { status: "sent" } as { status: string },
  signers: [] as Array<Record<string, string>>,
  voided: [] as string[],
}));
const notify = vi.hoisted(() => ({
  invitation: vi.fn(async (...a: unknown[]) => a.length >= 0),
  signed: vi.fn(async (...a: unknown[]) => void a),
  expired: vi.fn(async (...a: unknown[]) => void a),
}));

// Base mínima: agreements con select/eq/is/in/not/order/limit, update condicionado y maybeSingle.
function table(name: string) {
  const rows = name === "agreements" ? db.agreements : [];
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let wantRows = false;
  const q: Record<string, unknown> = {
    select: () => ((wantRows = true), q),
    update: (p: Row) => ((patch = p), q),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
    not: (c: string) => (filters.push((r) => r[c] != null), q),
    order: () => q,
    limit: () => q,
    // El más reciente primero (como order("created_at", desc) en el código).
    maybeSingle: async () => ({
      data:
        rows
          .filter((r) => filters.every((f) => f(r)))
          .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0] ?? null,
      error: null,
    }),
    then: (res: (v: unknown) => unknown) => {
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of hit) Object.assign(r, patch);
      return res({ data: wantRows || !patch ? hit.map((r) => ({ ...r })) : null, error: null });
    },
  };
  return q;
}

vi.mock("@/lib/supabase/service", () => ({ createService: () => ({ from: (t: string) => table(t) }) }));
vi.mock("@/lib/docusign", async (orig) => ({
  ...(await orig<typeof import("@/lib/docusign")>()),
  getEnvelopeStatus: async () => ({ ...ds.envelope }),
  getEnvelopeSigners: async () => ds.signers.map((s) => ({ ...s })),
  voidEnvelope: async (id: string) => {
    ds.voided.push(id);
    ds.envelope = { status: "voided" };
  },
}));
vi.mock("@/lib/cosigner-notify.server", () => ({
  notifyCosignerInvitation: (...a: unknown[]) => notify.invitation(...a),
  notifyCosignerSigned: (...a: unknown[]) => notify.signed(...a),
  notifySigningExpired: (...a: unknown[]) => notify.expired(...a),
}));
vi.mock("@/lib/funnel-events.server", () => ({ recordFunnelEvent: async () => undefined }));
vi.mock("@/lib/email", () => ({ sendAgreementSigned: async () => ({ ok: true }) }));
vi.mock("@/lib/email-recipient-lang", () => ({ lookupRecipientLang: async () => "es" }));

import { runSigningDeadlines } from "@/lib/signing-deadlines.server";
import { refreshAgreementResult } from "@/lib/agreement-refresh";

const DAY = 86_400_000;
const created = new Date("2026-11-02T15:00:00Z");
const at = (days: number) => new Date(created.getTime() + days * DAY);
const SELLER = { roleName: "Seller", clientUserId: "p1", name: "Ana Pérez", email: "ana@example.com", status: "sent" };
const SECOND = { roleName: "Seller 2", name: "Luis Pérez", email: "luis@example.com", status: "sent" };
const BROKER = { roleName: "Broker", name: "Broker", email: "broker@example.com", status: "created" };

beforeEach(() => {
  vi.clearAllMocks();
  db.agreements.length = 0;
  db.agreements.push({
    id: "a1",
    envelope_id: "env1",
    property_id: "p1",
    status: "sent",
    sellers_required: 2,
    additional_signer_signed_at: null,
    signing_deadline_at: new Date(created.getTime() + 7 * DAY).toISOString(),
    reminders_sent: 0,
    created_at: created.toISOString(),
  });
  ds.envelope = { status: "sent" };
  ds.signers = [SELLER, SECOND, BROKER];
  ds.voided.length = 0;
});

describe("cron /api/agreement/deadlines", () => {
  it("día 2: un recordatorio al segundo firmante (el del sobre); otra corrida el mismo día no repite", async () => {
    expect(await runSigningDeadlines(at(2.1))).toMatchObject({ checked: 1, reminded: 1, expired: 0 });
    expect(notify.invitation).toHaveBeenCalledWith("a1", "reminder", {
      reminder: 1,
      cosigner: { name: "Luis Pérez", email: "luis@example.com" },
    });
    expect(db.agreements[0].reminders_sent).toBe(1);
    expect(await runSigningDeadlines(at(2.5))).toMatchObject({ reminded: 0 });
    expect(notify.invitation).toHaveBeenCalledTimes(1);
  });

  it("día 5: el segundo recordatorio", async () => {
    db.agreements[0].reminders_sent = 1;
    await runSigningDeadlines(at(5.01));
    expect(notify.invitation).toHaveBeenCalledWith("a1", "reminder", expect.objectContaining({ reminder: 2 }));
    expect(db.agreements[0].reminders_sent).toBe(2);
  });

  it("día 7 sin la firma del segundo: anula el sobre, acuerdo 'expired', un aviso a los dos", async () => {
    vi.setSystemTime(at(7.05));
    expect(await runSigningDeadlines(at(7.05))).toMatchObject({ expired: 1 });
    expect(ds.voided).toEqual(["env1"]);
    expect(db.agreements[0].status).toBe("expired");
    expect(notify.expired).toHaveBeenCalledTimes(1);
    expect(notify.expired).toHaveBeenCalledWith("a1", { name: "Luis Pérez", email: "luis@example.com" });
    // Ya final: la próxima corrida no lo vuelve a tocar.
    expect(await runSigningDeadlines(at(7.2))).toMatchObject({ checked: 0 });
    expect(notify.expired).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("DocuSign ya lo venció (expireAfter): no se anula otra vez, pero queda 'expired' y se avisa", async () => {
    vi.setSystemTime(at(7.3));
    ds.envelope = { status: "voided" };
    expect(await runSigningDeadlines(at(7.3))).toMatchObject({ expired: 1 });
    expect(ds.voided).toEqual([]);
    expect(db.agreements[0].status).toBe("expired");
    expect(notify.expired).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("un acuerdo reemplazado por un sobre nuevo: ni recordatorio ni vencimiento", async () => {
    vi.setSystemTime(at(7.1));
    db.agreements.push({ ...db.agreements[0], id: "a2", envelope_id: "env2", created_at: at(1).toISOString(), signing_deadline_at: at(8).toISOString() });
    await runSigningDeadlines(at(7.1));
    expect(ds.voided).toEqual([]);
    expect(db.agreements[0].status).toBe("sent");
    expect(notify.expired).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("el segundo firmó (sin webhook): se marca, se avisa al vendedor y no hay recordatorio", async () => {
    ds.signers = [SELLER, { ...SECOND, status: "completed" }, BROKER];
    expect(await runSigningDeadlines(at(2.1))).toMatchObject({ reminded: 0, expired: 0 });
    expect(db.agreements[0].additional_signer_signed_at).toBeTruthy();
    expect(notify.signed).toHaveBeenCalledTimes(1);
    expect(notify.invitation).not.toHaveBeenCalled();
  });
});

describe("refreshAgreementResult con dos vendedores", () => {
  const ref = () => ({ id: "a1", envelope_id: "env1", property_id: "p1", status: "sent" });

  it("firma el segundo: un solo aviso al vendedor aunque lleguen dos lecturas", async () => {
    ds.signers = [SELLER, { ...SECOND, status: "completed" }, BROKER];
    await refreshAgreementResult(ref());
    await refreshAgreementResult(ref());
    expect(notify.signed).toHaveBeenCalledTimes(1);
    expect(db.agreements[0].status).toBe("sent");
  });

  it("firman los dos: 'signed' (pago) y sin el aviso de 'firmó el segundo'", async () => {
    ds.signers = [{ ...SELLER, status: "completed" }, { ...SECOND, status: "completed" }, BROKER];
    expect((await refreshAgreementResult(ref())).status).toBe("signed");
    expect(notify.signed).not.toHaveBeenCalled();
  });

  it("anulado ANTES del plazo (no por vencimiento): queda 'voided', sin aviso de plazo", async () => {
    vi.setSystemTime(at(3));
    ds.envelope = { status: "voided" };
    expect((await refreshAgreementResult(ref())).status).toBe("voided");
    expect(notify.expired).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
