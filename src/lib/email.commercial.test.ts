import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (...args: unknown[]) => {
        h.calls.push(args);
        return { data: { id: "email-1" }, error: null };
      },
    };
  },
}));

import { sendCommercialEmail } from "@/lib/email";
import { canSpamFooter, COMMERCIAL_SENDER } from "@/lib/email-compliance";

const FULL = { legalName: "Lixtara Realty LLC", postalAddress: "123 Example St, Miami, FL 33101" };
const UNSUB = "https://lixtara.com/en/unsubscribe?token=abc";
const base = { to: "seller@example.com", subject: "s", html: "<p>h</p>", text: "t", lang: "en" as const };

describe("canSpamFooter", () => {
  it("lists every missing piece", () => {
    const r = canSpamFooter("not-a-url", "en", { legalName: " ", postalAddress: "" });
    expect(r).toEqual({ ok: false, missing: ["legal_name", "postal_address", "unsubscribe_url"] });
  });

  it("rejects a non-https unsubscribe URL", () => {
    expect(canSpamFooter("http://lixtara.com/u", "en", FULL)).toEqual({
      ok: false,
      missing: ["unsubscribe_url"],
    });
  });

  it("includes legal name, postal address and unsubscribe link (EN/ES)", () => {
    const en = canSpamFooter(UNSUB, "en", FULL);
    const es = canSpamFooter(UNSUB, "es", FULL);
    if (!en.ok || !es.ok) throw new Error("expected ok");
    for (const f of [en.html, en.text]) {
      expect(f).toContain("Lixtara Realty LLC");
      expect(f).toContain("123 Example St, Miami, FL 33101");
    }
    expect(en.html).toContain(`href="https://lixtara.com/en/unsubscribe?token=abc"`);
    expect(en.text).toContain("Unsubscribe: " + UNSUB);
    expect(es.text).toContain("Darme de baja: " + UNSUB);
  });
});

describe("sendCommercialEmail", () => {
  afterEach(() => {
    h.calls.length = 0;
    vi.unstubAllEnvs();
  });

  it("the shipped placeholders are empty, so commercial email is blocked today", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    expect(COMMERCIAL_SENDER).toEqual({ legalName: "", postalAddress: "" });
    const r = await sendCommercialEmail({ ...base, unsubscribeUrl: UNSUB });
    expect(r).toMatchObject({ ok: false, error: "can_spam_incomplete" });
    expect(r.missing).toEqual(["legal_name", "postal_address"]);
    expect(h.calls).toHaveLength(0);
  });

  it("never sends without a valid unsubscribe URL, even with a full identity", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const r = await sendCommercialEmail({ ...base, unsubscribeUrl: "" }, FULL);
    expect(r.ok).toBe(false);
    expect(h.calls).toHaveLength(0);
  });

  it("sends with the footer appended and one-click List-Unsubscribe headers", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const r = await sendCommercialEmail({ ...base, unsubscribeUrl: UNSUB, idempotencyKey: "k1" }, FULL);
    expect(r.ok).toBe(true);
    expect(h.calls).toHaveLength(1);
    const [payload, opts] = h.calls[0] as [Record<string, unknown>, unknown];
    expect(payload.html).toContain("123 Example St, Miami, FL 33101");
    expect(payload.text).toContain("Unsubscribe: " + UNSUB);
    expect(payload.headers).toEqual({
      "List-Unsubscribe": `<${UNSUB}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(opts).toEqual({ idempotencyKey: "k1" });
  });
});
