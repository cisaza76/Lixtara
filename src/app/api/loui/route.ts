import { anthropic } from "@ai-sdk/anthropic";
import { streamText, tool, convertToModelMessages, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { LOUI_SYSTEM_PROMPT } from "@/lib/loui-prompt";
import { louiLimiter, clientIp, enforceLimit } from "@/lib/ratelimit";

const CHAT_MODEL = "claude-sonnet-4-6";

// Per-request input ceiling. The hourly rate limit caps how OFTEN someone can
// call; this caps how much they can spend per call (a single 1 MB message
// array would otherwise blow the token budget within the allowance).
const MAX_MESSAGES = 30;
const MAX_TOTAL_CHARS = 24_000;

function totalTextChars(messages: UIMessage[]): number {
  let n = 0;
  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (p.type === "text") n += p.text.length;
    }
  }
  return n;
}

const SCHEDULE_TYPES = [
  "consultation_attorney",
  "consultation_realtor",
  "strategy_call",
  "showing",
] as const;

export const maxDuration = 60;

interface LouiRequestBody {
  messages: UIMessage[];
}

export async function POST(req: Request) {
  let body: LouiRequestBody;
  try {
    body = (await req.json()) as LouiRequestBody;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const messages = Array.isArray(body.messages)
    ? (body.messages as UIMessage[]).slice(-MAX_MESSAGES)
    : [];

  if (totalTextChars(messages) > MAX_TOTAL_CHARS) {
    return Response.json(
      {
        error: "input_too_large",
        message: "That conversation is too long for Loui to process at once.",
      },
      { status: 413 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Rate-limit gate. Identity = user id when signed in, client IP otherwise.
  // Anonymous callers get a tighter window since they're the abuse vector.
  const limited = await enforceLimit(
    louiLimiter(user ? "user" : "anon"),
    user ? `u:${user.id}` : `ip:${clientIp(req)}`,
    {
      label: "loui",
      message:
        "You've reached the chat limit for now. Please try again in a little while" +
        (user ? "." : ", or sign in for more."),
    },
  );
  if (limited) return limited;

  const tools = {
    get_my_properties: tool({
      description:
        "Fetch the authenticated user's draft and published listings. Returns address, status, list price, bedrooms/baths, sqft, and pricing tier per property. Use whenever the user references THEIR property.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!user) {
          return {
            error: "not_signed_in",
            message:
              "The user is not signed in. Ask them to sign in to load their properties.",
          };
        }
        const { data, error } = await supabase
          .from("properties")
          .select(
            "id,address_street,address_city,address_state,address_zip,mls_status,list_price,bedrooms,bathrooms,sqft,pricing_tier,created_at",
          )
          .eq("owner_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) {
          return { error: "query_failed", message: error.message };
        }
        return { properties: data ?? [] };
      },
    }),
    get_offers_for_property: tool({
      description:
        "Fetch offers received on one of the user's properties. Pass property_id from get_my_properties.",
      inputSchema: z.object({
        property_id: z.string().describe("UUID of one of the user's properties"),
      }),
      execute: async ({ property_id }) => {
        if (!user) {
          return { error: "not_signed_in" };
        }
        const { data: prop } = await supabase
          .from("properties")
          .select("id")
          .eq("id", property_id)
          .eq("owner_id", user.id)
          .maybeSingle();
        if (!prop) {
          return {
            error: "not_found_or_not_yours",
            message: "Property not found or not owned by this user.",
          };
        }
        const { data, error } = await supabase
          .from("offers")
          .select("id,offer_amount,status,created_at,buyer_name,notes")
          .eq("property_id", property_id)
          .order("created_at", { ascending: false });
        if (error) {
          return { offers: [], note: "Offers feature not yet wired up." };
        }
        return { offers: data ?? [] };
      },
    }),
    request_schedule: tool({
      description:
        "Create a scheduling request that goes to Lixtara's brokerage. Use this whenever the user wants to talk to an attorney, realtor, broker, or schedule a showing — instead of inventing answers.",
      inputSchema: z.object({
        type: z.enum(SCHEDULE_TYPES),
        topic: z
          .string()
          .min(3)
          .describe("Short subject line — what is the call about"),
        preferred_time: z
          .string()
          .optional()
          .describe("Free-text preferred time, e.g. 'tomorrow morning'"),
        notes: z
          .string()
          .optional()
          .describe("Anything the specialist should know before the call"),
      }),
      execute: async ({ type, topic, preferred_time, notes }) => {
        if (!user) {
          return {
            error: "not_signed_in",
            message:
              "Ask the user to sign in or share their email so the brokerage can reach them.",
          };
        }
        const { error } = await supabase.from("schedule_requests").insert({
          user_id: user.id,
          request_type: type,
          topic,
          preferred_time: preferred_time ?? null,
          notes: notes ?? null,
          source: "loui_chat",
          status: "pending",
        });
        if (error) {
          return {
            error: "queue_failed",
            message:
              "We couldn't queue the request. The brokerage will follow up via your registered email.",
          };
        }
        return {
          scheduled: true,
          type,
          topic,
          response_window: "one business day",
        };
      },
    }),
  };

  const modelMessages = await convertToModelMessages(messages);
  const result = streamText({
    model: anthropic(CHAT_MODEL),
    system: LOUI_SYSTEM_PROMPT,
    messages: modelMessages,
    tools,
    stopWhen: ({ steps }) => steps.length >= 4,
  });

  return result.toUIMessageStreamResponse();
}
