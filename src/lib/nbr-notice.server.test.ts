// Aviso NBR, lado servidor, con la base y el correo simulados: el token solo viaja en el
// correo (en la base, su hash), el enlace vence y es de un solo uso, la aceptación guarda la
// evidencia y el PDF va al comprador y a la broker una sola vez.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ rows: [] as Row[] }));
const mail = vi.hoisted(() => ({
  link: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  accepted: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
}));
vi.mock("@/lib/email", () => ({
  sendNbrNoticeLink: (...a: unknown[]) => mail.link(...a),
  sendNbrNoticeAccepted: (...a: unknown[]) => mail.accepted(...a),
}));

function table() {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let insert: Row | null = null;
  const q: Record<string, unknown> = {
    insert: (r: Row) => ((insert = { id: `n${db.rows.length + 1}`, ...r }), db.rows.push(insert), q),
    update: (p: Row) => ((patch = p), q),
    select: () => q,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
    not: (c: string) => (filters.push((r) => r[c] != null), q),
    gt: (c: string, v: string) => (filters.push((r) => String(r[c] ?? "") > v), q),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
    order: () => q,
    single: async () => ({ data: insert, error: null }),
    maybeSingle: async () => {
      const hit = db.rows.filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of hit) Object.assign(r, patch);
      return { data: hit[0] ?? null, error: null };
    },
    then: (res: (v: unknown) => unknown) => {
      if (insert) return res({ data: null, error: null });
      const hit = db.rows.filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of hit) Object.assign(r, patch);
      return res({ data: hit, error: null });
    },
  };
  return q;
}
const svc = { from: () => table() } as never;

import {
  acceptFromLink,
  findOpenNotice,
  findUnverified,
  verifyEmail,
  hashToken,
  latestNotices,
  noticeTextSha256,
  recordInlineAcceptance,
  requestEvidence,
  sendNbrLink,
} from "@/lib/nbr-notice.server";
import { ESIGN_VERSION, NBR_NOTICE_VERSION } from "@/lib/nbr-notice";

const evidence = {
  fullName: "Jane Buyer",
  email: "jane@example.com",
  phone: null,
  listingLabel: "123 TEST Street",
  lang: "es" as const,
  ip: "203.0.113.7",
  userAgent: "TEST UA",
};

beforeEach(() => {
  db.rows.length = 0;
  vi.clearAllMocks();
});

function tokenFromMail(): string {
  const url = (mail.link.mock.calls[0]![0] as { url: string }).url;
  return url.split("/showing-notice/")[1]!;
}

describe("enlace del aviso", () => {
  it("en la base solo el hash del token; el token va en el correo", async () => {
    await sendNbrLink(svc, { leadId: "L1" }, { email: "jane@example.com", name: "Jane", lang: "es", listingLabel: "123 TEST Street" });
    const token = tokenFromMail();
    expect(db.rows[0]).toMatchObject({ lead_id: "L1", schedule_request_id: null, token_hash: hashToken(token), notice_version: NBR_NOTICE_VERSION });
    expect(JSON.stringify(db.rows[0])).not.toContain(token);
    expect((mail.link.mock.calls[0]![0] as { url: string }).url).toMatch(/\/es\/showing-notice\/[A-Za-z0-9_-]{43}$/);
  });

  it("vencido, aceptado o con token mal formado: no se abre", async () => {
    await sendNbrLink(svc, { scheduleRequestId: "S1" }, { email: "j@example.com", name: null, lang: "en", listingLabel: null });
    const token = tokenFromMail();
    expect(await findOpenNotice(svc, token)).not.toBeNull();
    expect(await findOpenNotice(svc, token, new Date(Date.now() + 15 * 86_400_000))).toBeNull();
    expect(await findOpenNotice(svc, "x")).toBeNull();
    db.rows[0]!.accepted_at = new Date().toISOString();
    expect(await findOpenNotice(svc, token)).toBeNull();
  });

  it("aceptar desde el enlace: guarda la evidencia, invalida el token y manda el PDF a los dos", async () => {
    await sendNbrLink(svc, { leadId: "L1" }, { email: "jane@example.com", name: "Jane", lang: "es", listingLabel: "123 TEST Street", propertyId: "P1" });
    const open = await findOpenNotice(svc, tokenFromMail());
    expect(await acceptFromLink(svc, open!.id, evidence)).toBe(true);
    expect(db.rows[0]).toMatchObject({
      full_name: "Jane Buyer",
      ip: "203.0.113.7",
      user_agent: "TEST UA",
      lang: "es",
      token_hash: null,
      property_id: "P1",
      notice_text_sha256: noticeTextSha256("es"),
      esign_version: ESIGN_VERSION,
    });
    expect(db.rows[0]!.esign_consent_at).toBe(db.rows[0]!.accepted_at);
    // El enlace llegó a su correo: queda verificado a la vez.
    expect(db.rows[0]!.email_verified_at).toBe(db.rows[0]!.accepted_at);
    expect(db.rows[0]!.accepted_at).toBeTruthy();
    expect(db.rows[0]!.pdf_emailed_at).toBeTruthy();
    const calls = mail.accepted.mock.calls.map((c) => c[0] as { recipient: string; to: string; idempotencyKey: string });
    expect(calls.map((c) => c.recipient).sort()).toEqual(["broker", "buyer"]);
    expect(calls.find((c) => c.recipient === "buyer")!.to).toBe("jane@example.com");
    expect(calls.every((c) => c.idempotencyKey.endsWith(open!.id))).toBe(true);
    // Segundo intento: ya no está pendiente.
    expect(await acceptFromLink(svc, open!.id, evidence)).toBe(false);
  });
});

describe("aceptación en el formulario", () => {
  it("nace aceptado con E-SIGN y el correo SIN verificar; el PDF al comprador lleva el enlace de verificación", async () => {
    const id = await recordInlineAcceptance(svc, { leadId: "L2" }, { ...evidence, propertyId: null, listingKey: "K1" });
    expect(id).toBeTruthy();
    expect(db.rows[0]).toMatchObject({ lead_id: "L2", listing_key: "K1", email: "jane@example.com", notice_version: NBR_NOTICE_VERSION, esign_version: ESIGN_VERSION });
    expect(db.rows[0]!.email_verified_at ?? null).toBeNull();
    expect(mail.accepted).toHaveBeenCalledTimes(2);
    const buyer = mail.accepted.mock.calls.map((c) => c[0] as { recipient: string; verifyUrl?: string | null }).find((c) => c.recipient === "buyer")!;
    const broker = mail.accepted.mock.calls.map((c) => c[0] as { recipient: string; verifyUrl?: string | null }).find((c) => c.recipient === "broker")!;
    expect(buyer.verifyUrl).toMatch(/\/es\/showing-notice\/verify\/[A-Za-z0-9_-]{43}$/);
    expect(broker.verifyUrl ?? null).toBeNull();
    const token = buyer.verifyUrl!.split("/verify/")[1]!;
    expect(db.rows[0]!.verify_token_hash).toBe(hashToken(token));
    expect(JSON.stringify(db.rows[0])).not.toContain(token);
  });

  it("verificar: abrir no verifica; el botón sí, una sola vez", async () => {
    await recordInlineAcceptance(svc, { leadId: "L3" }, evidence);
    const buyer = mail.accepted.mock.calls.map((c) => c[0] as { recipient: string; verifyUrl: string }).find((c) => c.recipient === "buyer")!;
    const token = buyer.verifyUrl.split("/verify/")[1]!;
    expect(await findUnverified(svc, token)).not.toBeNull();
    expect(db.rows[0]!.email_verified_at ?? null).toBeNull();
    expect(await verifyEmail(svc, token)).toBe(true);
    expect(db.rows[0]!.email_verified_at).toBeTruthy();
    expect(db.rows[0]!.verify_token_hash).toBeNull();
    expect(await verifyEmail(svc, token)).toBe(false);
    expect(await findUnverified(svc, token)).toBeNull();
    expect(await verifyEmail(svc, "x")).toBe(false);
  });
});

describe("evidencia y lectura", () => {
  it("IP (primer x-forwarded-for) y user agent recortados", () => {
    const h = new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1", "user-agent": "U".repeat(800) });
    expect(requestEvidence(h)).toEqual({ ip: "198.51.100.1", userAgent: "U".repeat(500) });
    expect(requestEvidence(new Headers())).toEqual({ ip: "unknown", userAgent: "unknown" });
  });

  it("el hash cambia con el idioma mostrado (en /es se mostraron los dos textos)", () => {
    expect(noticeTextSha256("es")).not.toBe(noticeTextSha256("en"));
    expect(noticeTextSha256("en")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("por lead, el aceptado gana sobre un reenvío posterior", async () => {
    db.rows.push(
      { id: "a", lead_id: "L1", accepted_at: "2026-10-29T10:00:00Z", sent_at: null },
      { id: "b", lead_id: "L1", accepted_at: null, sent_at: "2026-10-30T10:00:00Z" },
    );
    expect((await latestNotices(svc, "lead_id", ["L1"])).get("L1")!.id).toBe("a");
  });
});
