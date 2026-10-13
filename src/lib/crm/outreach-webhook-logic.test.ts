import { describe, it, expect, vi, afterEach } from "vitest";
import { sha256Hex, timingSafeEqual, toOutreachRow } from "./outreach-webhook-logic";

afterEach(() => vi.useRealTimers());

describe("sha256Hex", () => {
  it("runs on the Node runtime (global crypto.subtle) with the standard test vector", async () => {
    expect(typeof globalThis.crypto?.subtle?.digest).toBe("function");
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("timingSafeEqual", () => {
  it("compares values", () => {
    expect(timingSafeEqual("secret", "secret")).toBe(true);
    expect(timingSafeEqual("secret", "secreT")).toBe(false);
    expect(timingSafeEqual("secret", "secret-longer")).toBe(false);
    expect(timingSafeEqual("", "secret")).toBe(false);
  });
});

describe("toOutreachRow", () => {
  const reply = {
    timestamp: "2026-10-12T15:00:00.000Z",
    event_type: "reply_received",
    campaign_id: "camp-1",
    lead_email: "  Owner@Example.COM ",
    step: "2",
    email_id: "em-1",
    reply_subject: "Re: your property",
    reply_text_snippet: "Call me",
    owner_key: "ok-1",
  };

  it("maps an Instantly reply", async () => {
    const row = await toOutreachRow(reply);
    expect(row).toMatchObject({
      provider: "instantly",
      event_type: "reply_received",
      email: "owner@example.com",
      owner_key: "ok-1",
      provider_campaign_id: "camp-1",
      step: 2,
      reply_subject: "Re: your property",
      reply_text: "Call me",
      occurred_at: "2026-10-12T15:00:00.000Z",
    });
    expect(row?.event_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a retry of the same event produces the same hash", async () => {
    const a = await toOutreachRow(reply);
    const b = await toOutreachRow({ ...reply });
    expect(a?.event_hash).toBe(b?.event_hash);
  });

  it("a retry WITHOUT timestamp, minutes later, still produces the same hash", async () => {
    vi.useFakeTimers();
    const noDate = { ...reply, timestamp: undefined };
    vi.setSystemTime(new Date("2026-10-12T15:00:00.000Z"));
    const first = await toOutreachRow(noDate);
    vi.setSystemTime(new Date("2026-10-12T15:07:00.000Z"));
    const retry = await toOutreachRow({ ...noDate });
    expect(first?.event_hash).toBe(retry?.event_hash);
    // occurred_at is still the arrival time: only the hash ignores it.
    expect(first?.occurred_at).not.toBe(retry?.occurred_at);
  });

  it("different events get different hashes", async () => {
    const a = await toOutreachRow(reply);
    const b = await toOutreachRow({ ...reply, event_type: "lead_interested" });
    const c = await toOutreachRow({ ...reply, step: 3 });
    expect(new Set([a?.event_hash, b?.event_hash, c?.event_hash]).size).toBe(3);
  });

  it("ignores noise events and payloads without event_type", async () => {
    for (const t of ["email_opened", "link_clicked", "email_link_clicked", "account_error", "campaign_completed"]) {
      expect(await toOutreachRow({ ...reply, event_type: t })).toBeNull();
    }
    expect(await toOutreachRow({ lead_email: "x@example.com" })).toBeNull();
  });
});
