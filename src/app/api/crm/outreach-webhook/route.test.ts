import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory stand-in for the three tables the route touches. Same contract as
// PostgREST: upsert with ignoreDuplicates returns only the rows it inserted.
const db = {
  owners: [] as Array<{ id: string; owner_key: string; email: string | null }>,
  campaigns: [] as Array<{ id: string; provider: string; provider_campaign_id: string }>,
  outreach: [] as Array<Record<string, unknown>>,
  failInsert: false,
  limited: false,
};

function table(name: string) {
  const filters: Record<string, unknown> = {};
  const rows = () => {
    const src = name === "crm_owners" ? db.owners : name === "crm_campaigns" ? db.campaigns : [];
    return src.filter((r) => Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
  };
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => {
      filters[k] = v;
      return q;
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    upsert: (row: Record<string, unknown>) => ({
      select: async () => {
        if (db.failInsert) return { data: null, error: { code: "XX000", message: "boom" } };
        if (db.outreach.some((r) => r.event_hash === row.event_hash)) return { data: [], error: null };
        db.outreach.push(row);
        return { data: [{ id: `o-${db.outreach.length}` }], error: null };
      },
    }),
  };
  return q;
}

vi.mock("@/lib/supabase/service", () => ({ createService: () => ({ from: table }) }));
vi.mock("@/lib/ratelimit", () => ({
  apiLimiter: () => null,
  clientIp: () => "1.2.3.4",
  enforceLimit: async () =>
    db.limited ? Response.json({ error: "rate_limited" }, { status: 429 }) : null,
}));

import { POST } from "./route";

const TOKEN = "t".repeat(48);
const reply = {
  timestamp: "2026-10-12T15:00:00.000Z",
  event_type: "reply_received",
  campaign_id: "inst-camp-1",
  lead_email: "owner1@example.com",
  step: 1,
  email_id: "em-1",
  reply_subject: "Re: hello",
  reply_text: "Yes, call me",
  owner_key: "ok-1",
};

function post(body: unknown, opts: { header?: string; query?: string } = {}) {
  const url = new URL("https://lixtara.com/api/crm/outreach-webhook");
  if (opts.query !== undefined) url.searchParams.set("token", opts.query);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.header !== undefined) headers.authorization = `Bearer ${opts.header}`;
  return POST(new Request(url, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.stubEnv("OUTREACH_WEBHOOK_TOKEN", TOKEN);
  db.owners = [{ id: "owner-uuid-1", owner_key: "ok-1", email: "owner1@example.com" }];
  db.campaigns = [{ id: "camp-uuid-1", provider: "instantly", provider_campaign_id: "inst-camp-1" }];
  db.outreach = [];
  db.failInsert = false;
  db.limited = false;
});

describe("POST /api/crm/outreach-webhook — auth", () => {
  it("wrong token → 401, nothing stored", async () => {
    expect((await post(reply, { header: "nope" })).status).toBe(401);
    expect((await post(reply, { query: "nope" })).status).toBe(401);
    expect((await post(reply)).status).toBe(401);
    expect(db.outreach).toHaveLength(0);
  });

  it("token unset on the server → 401 (fail-closed), even with an empty token", async () => {
    vi.stubEnv("OUTREACH_WEBHOOK_TOKEN", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post(reply, { header: "" })).status).toBe(401);
    expect((await post(reply, { query: "" })).status).toBe(401);
  });

  it("accepts the Authorization header (primary) and ?token= (fallback)", async () => {
    expect((await post(reply, { header: TOKEN })).status).toBe(200);
    expect((await post({ ...reply, email_id: "em-2" }, { query: TOKEN })).status).toBe(200);
  });

  it("rate limited → 429 before touching the token or the DB", async () => {
    db.limited = true;
    expect((await post(reply, { header: TOKEN })).status).toBe(429);
    expect(db.outreach).toHaveLength(0);
  });
});

describe("POST /api/crm/outreach-webhook — storage", () => {
  it("reply_received is stored in crm_outreach, linked to owner and campaign", async () => {
    const res = await post(reply, { header: TOKEN });
    expect(await res.json()).toEqual({ ok: true, stored: 1, duplicates: 0, ignored: 0 });
    expect(db.outreach).toHaveLength(1);
    expect(db.outreach[0]).toMatchObject({
      event_type: "reply_received",
      owner_id: "owner-uuid-1",
      campaign_id: "camp-uuid-1",
      email: "owner1@example.com",
      reply_text: "Yes, call me",
    });
    expect(db.outreach[0]).not.toHaveProperty("owner_key");
  });

  it("the same event twice is stored once", async () => {
    await post(reply, { header: TOKEN });
    const res = await post(reply, { header: TOKEN });
    expect(await res.json()).toEqual({ ok: true, stored: 0, duplicates: 1, ignored: 0 });
    expect(db.outreach).toHaveLength(1);
  });

  it("falls back to email when owner_key is missing or unknown", async () => {
    await post({ ...reply, owner_key: "unknown" }, { header: TOKEN });
    expect(db.outreach[0]?.owner_id).toBe("owner-uuid-1");
  });

  it("unknown owner and campaign are stored with null links (never dropped)", async () => {
    await post({ ...reply, owner_key: undefined, lead_email: "nobody@example.com", campaign_id: "other" },
      { header: TOKEN });
    expect(db.outreach[0]).toMatchObject({ owner_id: null, campaign_id: null });
  });

  it("batches: noise events are ignored, the rest stored", async () => {
    const res = await post([reply, { ...reply, event_type: "email_opened" }, null], { header: TOKEN });
    expect(await res.json()).toEqual({ ok: true, stored: 1, duplicates: 0, ignored: 2 });
  });

  it("invalid JSON → 400; oversized batch → 413", async () => {
    expect((await post("{not json", { header: TOKEN })).status).toBe(400);
    expect((await post(Array.from({ length: 501 }, () => reply), { header: TOKEN })).status).toBe(413);
  });

  it("DB error → 500 so Instantly retries", async () => {
    db.failInsert = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post(reply, { header: TOKEN })).status).toBe(500);
  });
});
