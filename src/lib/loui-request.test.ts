import { describe, it, expect } from "vitest";
import { validateLouiMessages } from "@/lib/loui-request";

const textMsg = (role: string, text: string, extra: object = {}) => ({
  id: "m1",
  role,
  parts: [{ type: "text", text }],
  ...extra,
});

describe("validateLouiMessages — valid shapes are accepted", () => {
  it("1. real useChat UIMessage → ok", () => {
    expect(validateLouiMessages([textMsg("user", "hola")]).ok).toBe(true);
  });

  it("multi-turn history with assistant + extra fields + unknown part types → ok (no over-restriction)", () => {
    const history = [
      textMsg("user", "hola"),
      {
        id: "m2",
        role: "assistant",
        metadata: { x: 1 },
        parts: [
          { type: "text", text: "hi", state: "done" },
          { type: "tool-get_my_properties", toolCallId: "t1", state: "output-available", output: [] },
          { type: "step-start" },
        ],
      },
      textMsg("user", "sigue"),
    ];
    expect(validateLouiMessages(history).ok).toBe(true);
  });

  it("system role → ok", () => {
    expect(validateLouiMessages([textMsg("system", "ctx"), textMsg("user", "q")]).ok).toBe(true);
  });
});

describe("validateLouiMessages — malformed shapes are rejected", () => {
  it("2. legacy body without parts[] ({role, content}) → rejected", () => {
    const r = validateLouiMessages([{ role: "user", content: "hola" }]);
    expect(r.ok).toBe(false);
  });

  it("3. parts: null → rejected", () => {
    expect(validateLouiMessages([{ role: "user", parts: null }]).ok).toBe(false);
  });

  it("4. parts as object → rejected", () => {
    expect(validateLouiMessages([{ role: "user", parts: { type: "text", text: "x" } }]).ok).toBe(false);
  });

  it("5. messages absent/empty-body equivalents → rejected", () => {
    expect(validateLouiMessages(undefined).ok).toBe(false);
    expect(validateLouiMessages(null).ok).toBe(false);
    expect(validateLouiMessages({}).ok).toBe(false);
  });

  it("7. empty messages array → rejected (previously reached the model and threw AI_InvalidPromptError)", () => {
    expect(validateLouiMessages([]).ok).toBe(false);
  });

  it("8a. part without string type → rejected", () => {
    expect(validateLouiMessages([{ role: "user", parts: [{ text: "x" }] }]).ok).toBe(false);
    expect(validateLouiMessages([{ role: "user", parts: ["not-an-object"] }]).ok).toBe(false);
  });

  it("8b. text part with non-string text → rejected", () => {
    expect(validateLouiMessages([{ role: "user", parts: [{ type: "text", text: 42 }] }]).ok).toBe(false);
  });

  it("impossible role (previously threw in convertToModelMessages) → rejected", () => {
    expect(validateLouiMessages([textMsg("tool", "x")]).ok).toBe(false);
    expect(validateLouiMessages([textMsg("hacker", "x")]).ok).toBe(false);
  });

  it("12. rejection reason never used in responses — and carries no user content", () => {
    const r = validateLouiMessages([{ role: "user", content: "SECRETO-PRIVADO" }]);
    if (r.ok) throw new Error("expected rejection");
    expect(r.reason).not.toContain("SECRETO-PRIVADO");
  });
});
