import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as unknown[][], fail: false }));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (...args: unknown[]) => {
        h.calls.push(args);
        if (h.fail) throw new Error("provider down");
        return { data: { id: "email-1" }, error: null };
      },
    };
  },
}));

import { sendListingVideoTerminal } from "@/lib/email";

// UX 5C — the terminal sender is idempotent AT THE PROVIDER and never throws.
describe("sendListingVideoTerminal", () => {
  afterEach(() => {
    h.calls.length = 0;
    h.fail = false;
    vi.unstubAllEnvs();
  });

  it("passes the idempotency key to Resend (at-most-once per job+outcome)", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const r = await sendListingVideoTerminal({
      to: "seller@example.com",
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      idempotencyKey: "video-terminal-job1-completed",
    });
    expect(r.ok).toBe(true);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0][1]).toEqual({ idempotencyKey: "video-terminal-job1-completed" });
  });

  it("NEVER throws — provider explosion returns {ok:false}", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    h.fail = true;
    const r = await sendListingVideoTerminal({ to: "a@b.c", subject: "s", html: "h", text: "t", idempotencyKey: "k" });
    expect(r.ok).toBe(false);
  });

  it("missing API key degrades to {ok:false,'no_api_key'} without throwing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const r = await sendListingVideoTerminal({ to: "a@b.c", subject: "s", html: "h", text: "t", idempotencyKey: "k" });
    expect(r.ok).toBe(false);
  });
});
