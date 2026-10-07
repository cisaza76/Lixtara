import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeConnectSignature,
  handleConnectWebhook,
  hmacKeysFromEnv,
  sha256Hex,
  verifyConnectSignature,
  type WebhookDeps,
} from "./docusign-connect";

const KEY = "test-hmac-key";
const ENV_ID = "11111111-2222-3333-4444-555555555555";
const body = JSON.stringify({ event: "envelope-completed", data: { envelopeId: ENV_ID, envelopeSummary: { status: "completed" } } });

function headersWith(sigs: string[]): Headers {
  const h = new Headers({ "content-type": "application/json" });
  sigs.forEach((s, i) => h.set(`x-docusign-signature-${i + 1}`, s));
  return h;
}

describe("firma HMAC de Connect (#137 c)", () => {
  it("base64(HMAC-SHA256(cuerpo crudo)) — vector fijo", () => {
    // echo -n '{"a":1}' | openssl dgst -sha256 -hmac test-hmac-key -binary | base64
    expect(computeConnectSignature('{"a":1}', KEY)).toBe(
      "4UF1VDqXt3d3M6v7P3WBbXLgwY2O2Iiy8XL8L4I9TTM=",
    );
  });

  it("acepta la firma correcta en cualquier posición (rotación) y con cualquier clave", () => {
    const good = computeConnectSignature(body, KEY);
    expect(verifyConnectSignature(body, headersWith([good]), [KEY])).toBe(true);
    expect(verifyConnectSignature(body, headersWith(["bad", good]), [KEY])).toBe(true);
    expect(verifyConnectSignature(body, headersWith([computeConnectSignature(body, "new")]), [KEY, "new"])).toBe(true);
  });

  it("rechaza sin firma, firma de otra clave, o cuerpo alterado", () => {
    expect(verifyConnectSignature(body, headersWith([]), [KEY])).toBe(false);
    expect(verifyConnectSignature(body, headersWith([computeConnectSignature(body, "other")]), [KEY])).toBe(false);
    expect(verifyConnectSignature(body + " ", headersWith([computeConnectSignature(body, KEY)]), [KEY])).toBe(false);
    expect(verifyConnectSignature(body, headersWith([computeConnectSignature(body, KEY)]), [])).toBe(false);
  });

  it("claves desde el entorno, incluida la de rotación", () => {
    expect(hmacKeysFromEnv({ DOCUSIGN_CONNECT_HMAC_KEY: "a", DOCUSIGN_CONNECT_HMAC_KEY_2: "b" } as never)).toEqual(["a", "b"]);
    expect(hmacKeysFromEnv({} as never)).toEqual([]);
  });
});

type Call = { table: string; op: string; payload?: unknown };

function fakeDb(agreement: { id: string; property_id: string } | null, calls: Call[]) {
  return {
    from: (table: string) => {
      const call: Call = { table, op: "select" };
      const result = () => {
        calls.push(call);
        if (table === "agreements" && call.op === "select") return Promise.resolve({ data: agreement, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (p: unknown) => ((call.op = "insert"), (call.payload = p), b),
        update: (p: unknown) => ((call.op = "update"), (call.payload = p), b),
        eq: () => b,
        maybeSingle: result,
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => result().then(ok, ko),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

function setup(opts: {
  env?: Record<string, string>;
  agreement?: { id: string; property_id: string } | null;
  docusignStatus?: string;
  fetchFails?: boolean;
  claim?: "claimed" | "duplicate" | "unavailable";
}) {
  const calls: Call[] = [];
  const onSigned = vi.fn(async () => {});
  const getEnvelopeStatus = vi.fn(async () => {
    if (opts.fetchFails) throw new Error("down");
    return { status: opts.docusignStatus ?? "completed", completedDateTime: "2026-10-07T12:00:00Z" };
  });
  const deps: WebhookDeps = {
    db: () => fakeDb(opts.agreement === undefined ? { id: "ag1", property_id: "p1" } : opts.agreement, calls),
    getEnvelopeStatus,
    mapEnvelopeStatus: (s) => s as never,
    claimEvent: async () => opts.claim ?? "claimed",
    onSigned,
    env: { DOCUSIGN_CONNECT_HMAC_KEY: KEY, ...(opts.env ?? {}) } as never,
  };
  return { deps, calls, onSigned, getEnvelopeStatus };
}

const signed = (b = body, key = KEY) =>
  new Request("http://x/api/webhooks/docusign", { method: "POST", body: b, headers: headersWith([computeConnectSignature(b, key)]) });

describe("webhook /api/webhooks/docusign", () => {
  it("firma inválida → 401, sin tocar la base ni DocuSign", async () => {
    const { deps, calls, getEnvelopeStatus } = setup({});
    const res = await handleConnectWebhook(signed(body, "wrong"), deps);
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
    expect(getEnvelopeStatus).not.toHaveBeenCalled();
  });

  it("sin clave en Production → 401 (fail-closed)", async () => {
    const { deps } = setup({});
    deps.env = { VERCEL_ENV: "production" } as never;
    expect((await handleConnectWebhook(signed(), deps)).status).toBe(401);
  });

  it("sin clave fuera de Production → procesa y registra hmac_valid = false", async () => {
    const { deps, calls } = setup({});
    deps.env = { VERCEL_ENV: "preview" } as never;
    expect((await handleConnectWebhook(signed(), deps)).status).toBe(200);
    const ev = calls.find((c) => c.table === "docusign_events")!;
    expect(ev.payload).toMatchObject({ hmac_valid: false });
  });

  it("válido → estado CANÓNICO de DocuSign (no el del payload), registro y email", async () => {
    // El payload dice "completed" pero DocuSign dice "delivered" (falta la firma de la broker).
    const { deps, calls, onSigned } = setup({ docusignStatus: "delivered" });
    const res = await handleConnectWebhook(signed(), deps);
    expect(await res.json()).toEqual({ ok: true, status: "delivered" });
    const upd = calls.find((c) => c.table === "agreements" && c.op === "update")!;
    expect(upd.payload).toMatchObject({ status: "delivered" });
    expect((upd.payload as Record<string, unknown>).signed_at).toBeUndefined();
    expect(onSigned).not.toHaveBeenCalled();
    const ev = calls.find((c) => c.table === "docusign_events")!;
    expect(ev.payload).toMatchObject({
      envelope_id: ENV_ID, event_type: "envelope-completed", hmac_valid: true, duplicate: false,
      resulting_status: "delivered", payload_sha256: sha256Hex(body),
    });
  });

  it("completed → signed_at y aviso al vendedor una sola vez", async () => {
    const { deps, calls, onSigned } = setup({});
    await handleConnectWebhook(signed(), deps);
    const upd = calls.find((c) => c.table === "agreements" && c.op === "update")!;
    expect(upd.payload).toMatchObject({ status: "completed", signed_at: "2026-10-07T12:00:00Z" });
    expect(onSigned).toHaveBeenCalledTimes(1);
  });

  it("entrega duplicada → se registra como duplicado y no repite el email", async () => {
    const { deps, calls, onSigned } = setup({ claim: "duplicate" });
    const res = await handleConnectWebhook(signed(), deps);
    expect((await res.json()).note).toBe("duplicate");
    expect(onSigned).not.toHaveBeenCalled();
    expect(calls.find((c) => c.table === "docusign_events")!.payload).toMatchObject({ duplicate: true });
  });

  it("DocuSign no responde → 503 (Connect reintenta), sin actualizar el acuerdo", async () => {
    const { deps, calls } = setup({ fetchFails: true });
    expect((await handleConnectWebhook(signed(), deps)).status).toBe(503);
    expect(calls.some((c) => c.table === "agreements" && c.op === "update")).toBe(false);
  });

  it("sobre desconocido → 200 y registro", async () => {
    const { deps, calls } = setup({ agreement: null });
    const res = await handleConnectWebhook(signed(), deps);
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.table === "docusign_events")!.payload).toMatchObject({ note: "unknown_envelope" });
  });
});

describe("migración docusign_events (#137 b)", () => {
  const sql = readFileSync(
    join(resolve(__dirname, "../.."), "supabase/migrations/20261007180000_docusign_events.sql"), "utf8");
  it("solo inserción: la API no escribe; service_role solo SELECT + INSERT", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.docusign_events from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select, insert on public.docusign_events to service_role");
    expect(sql).not.toMatch(/grant[^;]*(update|delete)[^;]*docusign_events/i);
  });
  it("guarda el hash, no el cuerpo", () => {
    expect(sql).toContain("payload_sha256");
    expect(sql).not.toMatch(/\bpayload\s+(jsonb|text)/);
  });
});
