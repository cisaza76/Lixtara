// Código del paso 1: límites por correo y por IP antes de tocar la base o Resend (tope de gasto
// de Resend: un bot no puede agotarlo). Upstash, Supabase y Resend simulados: sin red.
import { describe, it, expect, vi, beforeEach } from "vitest";

const limitCalls: Array<{ name: string; max: number; window: string; id: string }> = [];
let blockedName: string | null = null;
const sendCode = vi.fn(async () => ({ ok: true }));
const from = vi.fn();

vi.mock("@/lib/ratelimit", () => ({
  apiLimiter: (name: string, max: number, window: string) => ({ name, max, window }),
  enforceLimit: async (l: { name: string; max: number; window: string }, id: string) => {
    limitCalls.push({ ...l, id });
    return l.name === blockedName ? new Response(null, { status: 429 }) : null;
  },
}));
vi.mock("@/lib/email", () => ({ sendListingEmailCode: (...a: unknown[]) => sendCode(...(a as [])), sendListingResumeLink: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  createService: () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "update", "insert"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => res({ count: 0, error: null });
    return { from: (...a: unknown[]) => (from(...a), q) };
  },
}));

import { EMAIL_CODE_LIMITS, startEmailChallenge } from "./listing-email-gate.server";

const input = { userId: "u1", email: "Seller@Example.com", lang: "en" as const, ip: "203.0.113.9" };

describe("código del paso 1: límites por correo y por IP", () => {
  beforeEach(() => {
    vi.stubEnv("EMAIL_CODE_PEPPER", "test-pepper");
    limitCalls.length = 0;
    blockedName = null;
    sendCode.mockClear();
    from.mockClear();
  });

  it("3 cada 10 min y 10 por día por correo; 10 cada 10 min y 30 por día por IP; nunca global", () => {
    expect(EMAIL_CODE_LIMITS.map((l) => [l.by, l.max, l.window])).toEqual([
      ["email", 3, "10 m"],
      ["email", 10, "1 d"],
      ["ip", 10, "10 m"],
      ["ip", 30, "1 d"],
    ]);
  });

  it("dentro del límite: consulta cada límite con el correo en minúsculas o la IP, y envía", async () => {
    expect(await startEmailChallenge(input)).toBe("sent");
    expect(limitCalls.map((c) => c.id)).toEqual(["seller@example.com", "seller@example.com", "203.0.113.9", "203.0.113.9"]);
    expect(sendCode).toHaveBeenCalledTimes(1);
  });

  it.each(EMAIL_CODE_LIMITS.map((l) => l.name))("%s agotado → 'limit', sin tocar la base ni Resend", async (name) => {
    blockedName = name;
    expect(await startEmailChallenge(input)).toBe("limit");
    expect(sendCode).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("los dos caminos que envían el código pasan la IP", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/[lang]/listing/new/page.tsx", "utf8");
    expect(page.match(/startEmailChallenge\(\{[^}]*ip: await requestIp\(\) \}\)/g)).toHaveLength(2);
  });
});
