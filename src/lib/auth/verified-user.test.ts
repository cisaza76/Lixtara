import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isListingSession,
  isVerifiedUser,
  listingResumeHref,
  requireVerifiedUser,
} from "@/lib/auth/verified-user";
import { parseSignupCode } from "@/lib/auth/signup-code";

const anon = { is_anonymous: true, email: "", email_confirmed_at: undefined, user_metadata: {} };
const pendingChange = { is_anonymous: true, email: "", email_confirmed_at: undefined, user_metadata: {}, new_email: "a@b.co" };
const step1 = { is_anonymous: false, email: "s@x.co", email_confirmed_at: "2026-10-15T02:37:00Z", user_metadata: { account_pending: true } };
const full = { is_anonymous: false, email: "s@x.co", email_confirmed_at: "2026-10-15T02:37:00Z", user_metadata: {} };

describe("isVerifiedUser / isListingSession", () => {
  it("anonymous step-1 session: not verified, still in the listing flow", () => {
    expect(isVerifiedUser(anon)).toBe(false);
    expect(isVerifiedUser(pendingChange)).toBe(false);
    expect(isListingSession(anon)).toBe(true);
  });
  it("email confirmed with the step-1 code but no password yet: verified, still in the flow", () => {
    expect(isVerifiedUser(step1)).toBe(true);
    expect(isListingSession(step1)).toBe(true);
  });
  it("complete account: verified, not a listing session", () => {
    expect(isVerifiedUser(full)).toBe(true);
    expect(isListingSession(full)).toBe(false);
  });
  it("email without confirmation, or anonymous flag left on, is not verified", () => {
    expect(isVerifiedUser({ ...full, email_confirmed_at: undefined })).toBe(false);
    expect(isVerifiedUser({ ...full, is_anonymous: true })).toBe(false);
    expect(isVerifiedUser(null)).toBe(false);
    expect(isListingSession(null)).toBe(false);
  });
});

function fakeSupabase(opts: { user?: unknown; draft?: { id: string } | null; lead?: unknown }) {
  return {
    auth: { getUser: async () => ({ data: { user: opts.user ?? null }, error: null }) },
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
      b.maybeSingle = async () => ({
        data: table === "properties" ? (opts.draft ?? null) : (opts.lead ?? null),
        error: null,
      });
      return b;
    },
  } as unknown as SupabaseClient;
}

describe("requireVerifiedUser", () => {
  it("401 not_authenticated with no session and with an anonymous one", async () => {
    for (const user of [null, anon]) {
      const r = await requireVerifiedUser(fakeSupabase({ user }));
      expect(r.user).toBeNull();
      expect(r.response?.status).toBe(401);
      expect(await r.response?.json()).toEqual({ error: "not_authenticated" });
    }
  });
  it("lets a confirmed email through", async () => {
    const r = await requireVerifiedUser(fakeSupabase({ user: full }));
    expect(r.response).toBeNull();
    expect(r.user).toBe(full);
  });
});

describe("listingResumeHref (Continuar mi listing)", () => {
  it("no draft → null (the header shows Sign in)", async () => {
    expect(await listingResumeHref(fakeSupabase({ draft: null }), "u1", "es")).toBeNull();
  });
  it("furthest step recorded by the email gate for this draft", async () => {
    const sb = fakeSupabase({ draft: { id: "p1" }, lead: { property_id: "p1", current_step: 6 } });
    expect(await listingResumeHref(sb, "u1", "es")).toBe("/es/listing/new?id=p1&step=6");
  });
  it("no lead, or a lead for another draft → step 1 of the newest draft", async () => {
    expect(await listingResumeHref(fakeSupabase({ draft: { id: "p1" } }), "u1", "en")).toBe(
      "/en/listing/new?id=p1&step=1",
    );
    const other = fakeSupabase({ draft: { id: "p1" }, lead: { property_id: "p0", current_step: 5 } });
    expect(await listingResumeHref(other, "u1", "en")).toBe("/en/listing/new?id=p1&step=1");
  });
});

describe("parseSignupCode", () => {
  it("accepts 6 digits, with or without a space", () => {
    expect(parseSignupCode("123456")).toBe("123456");
    expect(parseSignupCode(" 123 456 ")).toBe("123456");
  });
  it("rejects anything else", () => {
    for (const v of ["12345", "1234567", "abcdef", "", null]) expect(parseSignupCode(v)).toBeNull();
  });
});

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
function routeFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) return routeFiles(p);
    return name === "route.ts" ? [p] : [];
  });
}

describe("rutas que exigen un correo verificado (no sesión anónima)", () => {
  const routes = [
    "src/app/api/offers/route.ts",
    "src/app/api/saves/route.ts",
    "src/app/api/loui/route.ts",
    "src/app/api/staging/generate/route.ts",
    "src/app/api/tours/submit/route.ts",
    "src/app/api/media-agent/generate/route.ts",
    // The worker authenticates with CRON_SECRET, not a user session.
    ...routeFiles("src/app/api/creative-studio").filter((p) => !p.includes("/worker/")),
  ];
  it.each(routes)("%s", (p) => {
    const src = read(p);
    expect(src).toMatch(/requireVerifiedUser\(|isVerifiedUser\(/);
    expect(src).not.toMatch(/return user \? \{ id: user\.id \} : null/);
    // A raw session check right after getUser() would let the anonymous session in.
    expect(src).not.toMatch(/await supabase\.auth\.getUser\(\);\s*if \(!user\)/);
  });
});

describe("contraseña: nunca por la API admin (cierra todas las sesiones)", () => {
  it("ningún updateUserById en src fija una contraseña", () => {
    const offenders = routeFiles("src/app")
      .concat(["src/app/[lang]/listing/new/page.tsx", "src/app/[lang]/account/page.tsx", "src/lib/listing-email-gate.server.ts"])
      .filter((p) => /updateUserById\([^)]*\{[^}]*\bpassword\b/.test(read(p)));
    expect(offenders).toEqual([]);
  });
});
