// Structural validation for /api/loui chat requests (pre-Gate-5 P2, incident 2026-07-27).
//
// The AI SDK's `convertToModelMessages` assumes every message carries a `parts[]` array and a
// known role; a legacy-shaped body (`{ role, content }`, `parts: null`, unknown roles, …)
// previously reached it unvalidated and threw (`Cannot read properties of undefined (reading
// 'map')`) → an empty 500. This schema rejects those shapes as a controlled 400 BEFORE any
// auth, rate-limit token, tool construction, or model call is spent.
//
// Deliberately STRUCTURAL, not exhaustive: real `useChat` histories legitimately contain part
// types beyond text (tool invocations, files, reasoning, …) and extra fields (`id`,
// `metadata`). We only require what `convertToModelMessages` cannot survive without: an array
// of ≥1 message objects, a convertible role, `parts` as an array of objects each with a string
// `type`, and `text` being a string whenever `type === "text"`. Anything stricter would reject
// valid UI traffic.
import { z } from "zod";

const louiPartSchema = z
  .object({ type: z.string() })
  .passthrough()
  .superRefine((part, ctx) => {
    if (part.type === "text" && typeof (part as { text?: unknown }).text !== "string") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "text part requires string text" });
    }
  });

const louiMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant"]),
    parts: z.array(louiPartSchema),
  })
  .passthrough();

export const louiMessagesSchema = z.array(louiMessageSchema).min(1);

export type LouiRequestValidation = { ok: true } | { ok: false; reason: string };

// Validates the raw `body.messages` value. `reason` is for logs/tests only — the route
// responds with a stable, non-sensitive envelope and never echoes schema internals.
export function validateLouiMessages(value: unknown): LouiRequestValidation {
  const parsed = louiMessagesSchema.safeParse(value);
  if (parsed.success) return { ok: true };
  const first = parsed.error.issues[0];
  return { ok: false, reason: `${first?.path?.join(".") || "messages"}: ${first?.message ?? "invalid"}` };
}
