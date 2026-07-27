// Route-level regression for the Loui 500-on-malformed-body incident (pre-Gate-5 P2).
// The model, tools, auth, and limiter are mocked — no network, no Anthropic calls. What these
// tests pin: invalid bodies short-circuit as 400 WITHOUT touching the model pipeline; valid
// bodies keep the exact pre-fix flow (auth → limiter → convert → streamText → stream response).
import { describe, it, expect, vi, beforeEach } from "vitest";

const streamTextMock = vi.fn(() => ({
  toUIMessageStreamResponse: () => new Response("stream-ok", { status: 200 }),
}));
const convertMock = vi.fn(async (m: unknown[]) => m);
const enforceLimitMock = vi.fn(async (): Promise<Response | null> => null);

vi.mock("ai", () => ({
  streamText: (...a: unknown[]) => streamTextMock(...(a as [])),
  convertToModelMessages: (m: unknown[]) => convertMock(m),
  tool: (t: unknown) => t,
}));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: () => "mock-model" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}));
vi.mock("@/lib/ratelimit", () => ({
  louiLimiter: () => null,
  clientIp: () => "203.0.113.9",
  enforceLimit: (...a: unknown[]) => enforceLimitMock(...(a as [])),
}));

import { POST } from "./route";

const req = (body: unknown) =>
  new Request("https://lixtara.com/api/loui", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const validBody = { messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hola" }] }] };

beforeEach(() => {
  streamTextMock.mockClear();
  convertMock.mockClear();
  enforceLimitMock.mockClear();
});

describe("POST /api/loui — invalid requests are a controlled 400, never a 500", () => {
  const invalidBodies: Array<[string, unknown]> = [
    ["legacy {role, content} without parts", { messages: [{ role: "user", content: "hola" }] }],
    ["parts: null", { messages: [{ role: "user", parts: null }] }],
    ["parts as object", { messages: [{ role: "user", parts: { type: "text", text: "x" } }] }],
    ["empty body object", {}],
    ["empty messages array", { messages: [] }],
    ["unsupported role", { messages: [{ role: "tool", parts: [{ type: "text", text: "x" }] }] }],
  ];

  for (const [name, body] of invalidBodies) {
    it(`${name} → 400, model never called, no tools, no stream`, async () => {
      const res = await POST(req(body));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({
        error: "invalid_request",
        message: "The request body does not match the expected chat message format.",
      });
      expect(JSON.stringify(json)).not.toMatch(/\bstack\b|zod|ZodError|Bearer\s|sb_secret|Error:|\n\s+at\s/); // no stack, no internals
      expect(convertMock).not.toHaveBeenCalled();
      expect(streamTextMock).not.toHaveBeenCalled(); // 9/10: the model pipeline is never engaged
    });
  }

  it("6. malformed JSON → 400 invalid_json (existing behavior preserved)", async () => {
    const res = await POST(req("{not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json");
    expect(streamTextMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/loui — valid requests keep the pre-fix behavior", () => {
  it("14. valid UIMessage → passes validation, hits limiter, converts, streams", async () => {
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("stream-ok");
    expect(enforceLimitMock).toHaveBeenCalledTimes(1); // rate limiting intact
    expect(convertMock).toHaveBeenCalledTimes(1);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });

  it("13. rate limit still returns the limiter's 429 for valid bodies", async () => {
    enforceLimitMock.mockResolvedValueOnce(
      Response.json({ error: "rate_limited" }, { status: 429 }),
    );
    const res = await POST(req(validBody));
    expect(res.status).toBe(429);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("oversized input still returns the existing 413 (validation runs first, does not mask it)", async () => {
    const res = await POST(
      req({ messages: [{ role: "user", parts: [{ type: "text", text: "x".repeat(25_000) }] }] }),
    );
    expect(res.status).toBe(413);
    expect(streamTextMock).not.toHaveBeenCalled();
  });
});
