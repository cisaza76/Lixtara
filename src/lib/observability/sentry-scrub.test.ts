import { describe, it, expect } from "vitest";
import { scrubEvent, scrubBreadcrumb, redactSensitiveText } from "@/lib/observability/sentry-scrub";

const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlLXVzZXIifQ.c2lnbmF0dXJlLWZha2UtZmFrZQ";

describe("redactSensitiveText", () => {
  it("masks full email addresses (found live in the P1 production smoke)", () => {
    const s = redactSensitiveText("contact seller-x@example.com or demo@lixtara.test now");
    expect(s).not.toContain("seller-x@example.com");
    expect(s).not.toContain("demo@lixtara.test");
    expect(s).toContain("[REDACTED_EMAIL]");
  });

  it("masks bearer tokens, Supabase keys, PATs, and JWTs", () => {
    const s = redactSensitiveText(
      `Authorization: Bearer abc123XYZ; key sb_secret_LIVEKEY1; pat sbp_deadbeef99; jwt ${FAKE_JWT}`,
    );
    expect(s).not.toContain("abc123XYZ");
    expect(s).not.toContain("sb_secret_LIVEKEY1");
    expect(s).not.toContain("sbp_deadbeef99");
    expect(s).not.toContain(FAKE_JWT);
    expect(s).toContain("Bearer [REDACTED]");
    expect(s).toContain("[REDACTED_KEY]");
    expect(s).toContain("[REDACTED_JWT]");
  });

  it("strips signed-URL and magic-link query strings + auth fragments", () => {
    const s = redactSensitiveText(
      "GET https://x.supabase.co/storage/v1/object/sign/b/p.mp4?token=SECRETTOKEN&X-Amz-Signature=SIG " +
        "and https://x.supabase.co/auth/v1/verify?token=MAGIC&type=magiclink " +
        "and https://lixtara.com/en#access_token=HASHTOKEN",
    );
    expect(s).not.toContain("SECRETTOKEN");
    expect(s).not.toContain("SIG");
    expect(s).not.toContain("MAGIC");
    expect(s).not.toContain("HASHTOKEN");
    expect(s).toContain("?[REDACTED]");
  });
});

describe("scrubEvent (beforeSend)", () => {
  const baseEvent = () => ({
    message: "boom",
    request: {
      url: "https://lixtara.com/api/loui?debug=1&token=QSECRET",
      query_string: "debug=1&token=QSECRET",
      cookies: { "sb-fizhoufepowilbhbtfkg-auth-token": "COOKIEJWT" },
      data: { messages: [{ role: "user", parts: [{ type: "text", text: "MENSAJE PRIVADO DEL USUARIO" }] }] },
      headers: {
        host: "lixtara.com",
        cookie: "sb-auth=COOKIEJWT",
        authorization: "Bearer REQTOKEN",
        apikey: "sb_secret_HDRKEY",
        "user-agent": "Mozilla/5.0",
        "content-type": "application/json",
      },
    },
    user: { email: "seller@example.com", ip_address: "1.2.3.4" },
    extra: { signedUrl: "https://x.supabase.co/storage/v1/object/sign/a.mp4?token=EXTRATOK", note: "ok" },
    contexts: { runtime: { name: "node" }, secretish: { jwt: FAKE_JWT } },
    tags: { route: "/api/loui" },
    exception: {
      values: [
        {
          type: "TypeError",
          value: `fetch failed after Bearer LEAKED at https://h.upstash.io/get?token=T1`,
          stacktrace: { frames: [{ filename: "route.ts", lineno: 42 }] },
        },
      ],
    },
  });

  it("19-25: removes cookies, bodies, auth headers, user object; redacts query/urls/extras", () => {
    const e = scrubEvent(baseEvent())!;
    const raw = JSON.stringify(e);
    expect(e.request.cookies).toBeUndefined();
    expect(e.request.data).toBeUndefined();
    expect(e.user).toBeUndefined();
    expect(raw).not.toContain("COOKIEJWT");
    expect(raw).not.toContain("REQTOKEN");
    expect(raw).not.toContain("sb_secret_HDRKEY");
    expect(raw).not.toContain("QSECRET");
    expect(raw).not.toContain("EXTRATOK");
    expect(raw).not.toContain("MENSAJE PRIVADO");
    expect(raw).not.toContain("seller@example.com");
    expect(raw).not.toContain(FAKE_JWT);
    expect(raw).not.toContain("LEAKED");
    expect(raw).not.toContain("token=T1");
  });

  it("preserves operational value: type, stack frames, route, safe headers, redacted message", () => {
    const e = scrubEvent(baseEvent())!;
    expect(e.exception.values[0].type).toBe("TypeError");
    expect(e.exception.values[0].stacktrace.frames[0]).toEqual({ filename: "route.ts", lineno: 42 });
    expect(e.exception.values[0].value).toContain("fetch failed"); // the useful part survives
    expect(e.request.url).toBe("https://lixtara.com/api/loui?[REDACTED]");
    expect(e.request.headers.host).toBe("lixtara.com");
    expect(e.request.headers["user-agent"]).toBe("Mozilla/5.0");
    expect(e.tags.route).toBe("/api/loui");
    expect(e.contexts.runtime.name).toBe("node");
    expect(e.extra.note).toBe("ok");
  });

  it("drops non-object events instead of sending garbage", () => {
    expect(scrubEvent(null as never)).toBeNull();
    expect(scrubEvent("weird" as never)).toBeNull();
  });
});

describe("scrubBreadcrumb (beforeBreadcrumb)", () => {
  it("redacts messages and http data; drops bodies", () => {
    const b = scrubBreadcrumb({
      category: "fetch",
      message: `fetch https://api.example.com/x?apikey=BCSECRET with Bearer BCTOKEN`,
      data: {
        url: "https://x.supabase.co/auth/v1/verify?token=BMAGIC",
        method: "POST",
        body: '{"messages":[{"text":"privado"}]}',
        status_code: 200,
      },
    })!;
    const raw = JSON.stringify(b);
    expect(raw).not.toContain("BCSECRET");
    expect(raw).not.toContain("BCTOKEN");
    expect(raw).not.toContain("BMAGIC");
    expect(raw).not.toContain("privado");
    expect(b.data.method).toBe("POST");
    expect(b.data.status_code).toBe(200);
  });
});
