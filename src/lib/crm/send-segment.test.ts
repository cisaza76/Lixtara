import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSegmentToInstantly, SENDABLE_VIEW } from "./send-segment.server";
import { addLeadsToCampaign, INSTANTLY_ADD_LEADS_URL } from "./instantly.server";

const INSTANTLY_CAMPAIGN = "01a1318c-d386-72d0-89f1-ff301dad5bcb";

// ── Fake Supabase: records every table touched and every filter applied ──────────
interface Call { table: string; op: string; args: unknown[] }
const db = {
  calls: [] as Call[],
  campaign: null as Record<string, unknown> | null,
  members: [] as Array<{ campaign_id: string; owner_id: string; pilot_group: string | null }>,
  sendable: [] as Array<{ id: string; owner_key: string; email: string; pilot_group: string | null }>,
  membersInsertError: null as { code: string } | null,
};

function fakeClient(): SupabaseClient {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let range: [number, number] = [0, 999];
      let op = "select";
      let payload: unknown;
      const run = () => {
        db.calls.push({ table, op, args: [filters.slice(), payload] });
        if (op === "upsert" && table === "crm_campaign_members") {
          if (db.membersInsertError) return { data: null, error: db.membersInsertError };
          for (const m of payload as typeof db.members) {
            if (!db.members.some((x) => x.campaign_id === m.campaign_id && x.owner_id === m.owner_id)) db.members.push(m);
          }
          return { data: null, error: null };
        }
        if (op === "update") {
          if (db.campaign) Object.assign(db.campaign, payload);
          return { data: null, error: null };
        }
        if (table === "crm_campaigns") return { data: db.campaign, error: null };
        if (table === "crm_campaign_members") {
          return { data: db.members.slice(range[0], range[1] + 1), error: null };
        }
        if (table === SENDABLE_VIEW) {
          return { data: db.sendable.slice(range[0], range[1] + 1), error: null };
        }
        throw new Error(`unexpected table ${table}`);
      };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        is: (c: string, v: unknown) => (filters.push([`${c} is`, v]), q),
        not: (c: string, o: string, v: unknown) => (filters.push([`${c} not ${o}`, v]), q),
        order: () => q,
        range: (a: number, b: number) => ((range = [a, b]), Promise.resolve(run())),
        maybeSingle: () => Promise.resolve(run()),
        upsert: (rows: unknown) => ((op = "upsert"), (payload = rows), Promise.resolve(run())),
        update: (patch: unknown) => {
          op = "update";
          payload = patch;
          return { eq: (c: string, v: unknown) => (filters.push([c, v]), Promise.resolve(run())) };
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

// ── Fake Instantly ───────────────────────────────────────────────────────────────
function instantlyOk() {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { leads: unknown[] };
    return Response.json({
      status: "success",
      total_sent: body.leads.length,
      leads_uploaded: body.leads.length,
      in_blocklist: 0,
      blocklist_used: null,
      duplicated_leads: 0,
      created_leads: body.leads.map((_, index) => ({ index, id: `lead-${index}` })),
    });
  });
}

const owner = (i: number, group = i % 2 ? "Score" : "Control") => ({
  id: `owner-${String(i).padStart(4, "0")}`, owner_key: `ok-${i}`, email: `o${i}@example.com`, pilot_group: group,
});

beforeEach(() => {
  db.calls = [];
  db.members = [];
  db.membersInsertError = null;
  db.sendable = [owner(1), owner(2), owner(3)];
  db.campaign = {
    id: "camp-1", channel: "email", provider: "instantly", provider_campaign_id: INSTANTLY_CAMPAIGN,
    segment: { priority: "A", zip: "33133", signal: "mls_expirado" }, status: "Borrador",
  };
});

const send = (fetchImpl: typeof fetch) =>
  sendSegmentToInstantly({ supabase: fakeClient(), campaignId: "camp-1", apiKey: "key-123", fetchImpl });

describe("sendSegmentToInstantly", () => {
  it("reads owners ONLY from crm_sendable_email_owners, never crm_owners", async () => {
    await send(instantlyOk() as unknown as typeof fetch);
    const tables = new Set(db.calls.map((c) => c.table));
    expect(tables.has("crm_owners")).toBe(false);
    expect(tables.has(SENDABLE_VIEW)).toBe(true);
  });

  it("applies the stored segment (and drops unknown keys such as mls_expirado)", async () => {
    await send(instantlyOk() as unknown as typeof fetch);
    const viewCall = db.calls.find((c) => c.table === SENDABLE_VIEW)!;
    expect(viewCall.args[0]).toEqual([
      ["priority", "A"],
      ["crm_property_owners.crm_properties.zip", "33133"],
      ["crm_property_owners.valid_to is", null],
    ]);
  });

  it("posts to the verified endpoint with owner_key as a custom variable", async () => {
    const f = instantlyOk();
    const out = await send(f as unknown as typeof fetch);
    expect(out).toMatchObject({ ok: true, batch: 3, moreRemaining: false });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(INSTANTLY_ADD_LEADS_URL);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer key-123");
    const body = JSON.parse(String(init?.body));
    expect(body.campaign_id).toBe(INSTANTLY_CAMPAIGN);
    expect(body.skip_if_in_workspace).toBe(true);
    expect(body.leads[0]).toEqual({ email: "o1@example.com", custom_variables: { owner_key: "ok-1" } });
  });

  it("snapshots created leads into crm_campaign_members with their pilot group and activates the campaign", async () => {
    await send(instantlyOk() as unknown as typeof fetch);
    expect(db.members).toEqual([
      { campaign_id: "camp-1", owner_id: "owner-0001", pilot_group: "Score" },
      { campaign_id: "camp-1", owner_id: "owner-0002", pilot_group: "Control" },
      { campaign_id: "camp-1", owner_id: "owner-0003", pilot_group: "Score" },
    ]);
    expect(db.campaign?.status).toBe("Activa");
  });

  it("only records the leads Instantly created (blocklist / skipped are not members)", async () => {
    const f = vi.fn(async () => Response.json({
      status: "success", total_sent: 3, leads_uploaded: 1, in_blocklist: 1, skipped_count: 1,
      blocklist_used: null, duplicated_leads: 0, created_leads: [{ index: 2, id: "lead-x" }],
    }));
    const out = await send(f as unknown as typeof fetch);
    expect(out).toMatchObject({ ok: true, result: { uploaded: 1, inBlocklist: 1, skipped: 1, createdIndexes: [2] } });
    expect(db.members.map((m) => m.owner_id)).toEqual(["owner-0003"]);
  });

  it("never re-sends current members; nothing left → nothing_to_send", async () => {
    const f = instantlyOk();
    await send(f as unknown as typeof fetch);
    const second = await send(f as unknown as typeof fetch);
    expect(second).toEqual({ ok: false, error: "nothing_to_send" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("caps one click at 1000 leads and reports that more remain", async () => {
    db.sendable = Array.from({ length: 1500 }, (_, i) => owner(i + 1));
    const f = instantlyOk();
    const out = await send(f as unknown as typeof fetch);
    expect(out).toMatchObject({ ok: true, batch: 1000, moreRemaining: true });
    expect(JSON.parse(String(f.mock.calls[0][1]?.body)).leads).toHaveLength(1000);
    const next = await send(f as unknown as typeof fetch);
    expect(next).toMatchObject({ ok: true, batch: 500, moreRemaining: false });
  });

  it("guards: postal / missing Instantly id / finished campaign never call Instantly", async () => {
    const f = instantlyOk();
    db.campaign = { ...db.campaign!, channel: "postal" };
    expect(await send(f as unknown as typeof fetch)).toEqual({ ok: false, error: "not_email" });
    db.campaign = { ...db.campaign!, channel: "email", provider_campaign_id: null };
    expect(await send(f as unknown as typeof fetch)).toEqual({ ok: false, error: "no_provider_id" });
    db.campaign = { ...db.campaign!, provider_campaign_id: INSTANTLY_CAMPAIGN, status: "Terminada" };
    expect(await send(f as unknown as typeof fetch)).toEqual({ ok: false, error: "finished" });
    db.campaign = null;
    expect(await send(f as unknown as typeof fetch)).toEqual({ ok: false, error: "not_found" });
    expect(f).not.toHaveBeenCalled();
  });

  it("Instantly error → no members recorded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    expect(await send(f as unknown as typeof fetch)).toEqual({ ok: false, error: "instantly" });
    expect(db.members).toHaveLength(0);
    expect(db.campaign?.status).toBe("Borrador");
  });
});

describe("addLeadsToCampaign", () => {
  it("rejects bad input before any network call", async () => {
    const f = vi.fn();
    await expect(addLeadsToCampaign({ apiKey: "k", campaignId: "nope", leads: [] }, f as unknown as typeof fetch))
      .rejects.toThrow(/campaign id/);
    await expect(addLeadsToCampaign({ apiKey: "k", campaignId: INSTANTLY_CAMPAIGN, leads: [] }, f as unknown as typeof fetch))
      .rejects.toThrow(/1\.\.1000/);
    expect(f).not.toHaveBeenCalled();
  });
});
