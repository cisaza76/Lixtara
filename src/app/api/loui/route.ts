import { anthropic } from "@ai-sdk/anthropic";
import { streamText, tool, convertToModelMessages, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isVerifiedUser } from "@/lib/auth/verified-user";
import { LOUI_SYSTEM_PROMPT } from "@/lib/loui-prompt";
import { louiLimiter, clientIp, enforceLimit } from "@/lib/ratelimit";
import { validateLouiMessages } from "@/lib/loui-request";
import { createService } from "@/lib/supabase/service";
import { hasOwnAgent, normalizeAgentLicense } from "@/lib/nbr-notice";
import { sendNbrLink } from "@/lib/nbr-notice.server";

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

// Sin "consultation_attorney": Lixtara no agenda ni vende consultas legales; para un abogado
// Loui da el referido a una firma independiente (src/config/legalPartner.ts). El valor sigue
// permitido en la tabla schedule_requests (CHECK) para las filas existentes.
const SCHEDULE_TYPES = [
  "consultation_realtor",
  "strategy_call",
  "showing",
] as const;

export const maxDuration = 60;

interface LouiRequestBody {
  messages: UIMessage[];
  /** Language of the page the widget is on (sent by the client transport). */
  lang?: string;
}

// The prompt defaults to English; on the Spanish site Loui starts in Spanish instead.
// Either way it still follows the language the user actually writes in.
const SPANISH_PAGE_NOTE = `

# Page language
The user is browsing the Spanish version of the site. Reply in Spanish (Latin American, using "tú") unless the user writes to you in English.`;

export async function POST(req: Request) {
  let body: LouiRequestBody;
  try {
    body = (await req.json()) as LouiRequestBody;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  // Structural validation BEFORE any work (mirrors the 413 gate below): a malformed body must
  // never reach `convertToModelMessages`/the model — it used to throw there and surface as an
  // empty 500. Stable, non-sensitive envelope; schema internals are never echoed.
  const valid = validateLouiMessages(body.messages);
  if (!valid.ok) {
    return Response.json(
      {
        error: "invalid_request",
        message: "The request body does not match the expected chat message format.",
      },
      { status: 400 },
    );
  }
  const messages = (body.messages as UIMessage[]).slice(-MAX_MESSAGES);

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
    data: { user: sessionUser },
  } = await supabase.auth.getUser();
  // An anonymous listing-flow session (no confirmed email) is a visitor here:
  // visitor rate limit, and no account tools (schedule requests, offers).
  const user = isVerifiedUser(sessionUser) ? sessionUser : null;

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
        "Create a scheduling request that goes to Lixtara's brokerage. Use this whenever the user wants to talk to a realtor or the broker, or schedule a showing, instead of inventing answers. Never use it for legal questions: Lixtara is not a law firm; give the attorney referral instead. For 'showing', first ask whether the buyer signed an agreement with their own real estate agent and pass buyer_agent_status; if they have an agent, also pass the agent's name and Florida license. A showing request is never a confirmed showing.",
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
        buyer_agent_status: z
          .enum(["exclusive", "non_exclusive", "none", "unsure"])
          .optional()
          .describe("Showings only: has the buyer signed an agreement with their own agent? exclusive / non_exclusive / none / unsure"),
        buyer_agent_name: z.string().max(120).optional().describe("Showings only, buyer with an agent: the agent's name"),
        buyer_agent_license: z.string().max(20).optional().describe("Showings only, buyer with an agent: the agent's Florida license number"),
      }),
      execute: async ({ type, topic, preferred_time, notes, buyer_agent_status, buyer_agent_name, buyer_agent_license }) => {
        if (!user) {
          return {
            error: "not_signed_in",
            message:
              "Ask the user to sign in or share their email so the brokerage can reach them.",
          };
        }
        // Visitas (F.S. 475.278(4)): con agente, su nombre y licencia; sin agente o sin saberlo,
        // el aviso NBR por correo, que el comprador acepta antes de la visita.
        const showing = type === "showing";
        const withAgent = showing && hasOwnAgent(buyer_agent_status);
        const license = withAgent ? normalizeAgentLicense(buyer_agent_license ?? "") : null;
        if (showing && !buyer_agent_status) {
          return { error: "buyer_agent_status_required", message: "Ask whether the buyer signed an agreement with their own real estate agent before requesting the showing." };
        }
        if (withAgent && (!buyer_agent_name?.trim() || !license)) {
          return { error: "buyer_agent_required", message: "Ask for the buyer's agent name and Florida license number." };
        }
        const { data: created, error } = await supabase
          .from("schedule_requests")
          .insert({
            user_id: user.id,
            request_type: type,
            topic,
            preferred_time: preferred_time ?? null,
            notes: notes ?? null,
            source: "loui_chat",
            status: "pending",
            ...(showing
              ? {
                  buyer_agent_status,
                  buyer_agent_name: withAgent ? buyer_agent_name!.trim() : null,
                  buyer_agent_license: license,
                }
              : {}),
          })
          .select("id")
          .single();
        if (error || !created) {
          return {
            error: "queue_failed",
            message:
              "We couldn't queue the request. The brokerage will follow up via your registered email.",
          };
        }
        if (showing && !withAgent && user.email) {
          const name = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
          const sent = await sendNbrLink(createService(), { scheduleRequestId: created.id as string }, {
            email: user.email,
            name,
            lang: body.lang === "es" ? "es" : "en",
            listingLabel: topic.slice(0, 300),
          });
          return {
            requested: true,
            confirmed: false,
            type,
            topic,
            nbr_notice_emailed: sent.ok,
            note: "The showing is not confirmed. The buyer must accept the No Brokerage Relationship notice emailed to them, and the broker confirms the showing.",
          };
        }
        return {
          requested: true,
          confirmed: false,
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
    system: body.lang === "es" ? LOUI_SYSTEM_PROMPT + SPANISH_PAGE_NOTE : LOUI_SYSTEM_PROMPT,
    messages: modelMessages,
    tools,
    stopWhen: ({ steps }) => steps.length >= 4,
  });

  return result.toUIMessageStreamResponse();
}
