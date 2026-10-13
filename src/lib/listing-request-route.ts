// Handler común de POST /api/listings/[id]/change-request (#136) y
// POST /api/listings/[id]/withdrawal-request (#134).
//
// Nunca escribe properties: valida sesión, dueño, estado y campos, y crea una solicitud +
// una tarea para la broker. La broker la pasa a Matrix y la aprueba en /admin; solo
// entonces se aplica (listing-requests.server.ts).
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";
import {
  CHANGEABLE_FIELD_NAMES,
  canRequest,
  cleanReason,
  describeChanges,
  parseChangeRequest,
  type ChangeSet,
  type ListingRequestKind,
} from "@/lib/listing-requests";
import { createListingRequest } from "@/lib/listing-requests.server";
import { sendBrokerListingRequest } from "@/lib/email";
import { isUuid } from "@/lib/listing-request-ids";

export interface ListingRequestDeps {
  sessionClient: () => Promise<SupabaseClient>;
  serviceClient: () => SupabaseClient | null;
  limit: (userId: string) => Promise<Response | null>;
  notifyBroker: typeof sendBrokerListingRequest;
}

const defaultDeps: ListingRequestDeps = {
  sessionClient: async () => (await createClient()) as unknown as SupabaseClient,
  serviceClient: () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return null;
    return createServiceClient(url, key, { auth: { persistSession: false } });
  },
  limit: (userId) =>
    enforceLimit(apiLimiter("listing-request", 10, "1 h"), userId, {
      message: "Too many requests. Try again later.",
      label: "listing-request",
    }),
  notifyBroker: sendBrokerListingRequest,
};

const json = (body: unknown, status: number) => Response.json(body, { status });

export async function handleListingRequest(
  req: Request,
  propertyId: string,
  kind: ListingRequestKind,
  deps: ListingRequestDeps = defaultDeps,
): Promise<Response> {
  const supabase = await deps.sessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "not_authenticated" }, 401);

  const limited = await deps.limit(user.id);
  if (limited) return limited;

  if (!isUuid(propertyId)) return json({ error: "property_not_found" }, 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // Lectura con la sesión: RLS solo devuelve listings propios (o activos públicos).
  const { data: property } = await supabase
    .from("properties")
    .select(["id", "owner_id", "mls_status", "is_test", "address_state", ...CHANGEABLE_FIELD_NAMES].join(","))
    .eq("id", propertyId)
    .maybeSingle();
  const prop = property as unknown as (Record<string, unknown> & {
    owner_id: string;
    mls_status: string | null;
    address_street: string;
    address_city: string;
  }) | null;
  // Ajeno o inexistente: misma respuesta, no se revela que existe.
  if (!prop || prop.owner_id !== user.id) return json({ error: "property_not_found" }, 404);
  if (!canRequest(kind, prop.mls_status)) {
    return json({ error: kind === "change" ? "edit_directly_or_contact_broker" : "not_withdrawable", status: prop.mls_status }, 409);
  }

  const reason = cleanReason((body as { reason?: unknown } | null)?.reason);
  let changes: ChangeSet | undefined;
  if (kind === "change") {
    const parsed = parseChangeRequest(body, prop);
    if (!parsed.ok) {
      return json({ error: parsed.error, ...("field" in parsed ? { field: parsed.field } : {}) }, 400);
    }
    changes = parsed.changes;
  }

  const svc = deps.serviceClient();
  if (!svc) return json({ error: "server_misconfigured" }, 500);

  const address = `${prop.address_street}, ${prop.address_city}`;
  const created = await createListingRequest(svc, {
    kind,
    propertyId,
    userId: user.id,
    address,
    changes,
    reason,
  });
  if (!created.ok) {
    return created.error === "request_pending"
      ? json({ error: "request_pending" }, 409)
      : json({ error: "request_failed" }, 500);
  }

  // Aviso a la broker: best-effort (sendBrokerListingRequest nunca lanza).
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lixtara.com";
  await deps.notifyBroker({
    to: process.env.BROKER_NOTIFICATION_EMAIL ?? "camilo.isaza@gmail.com",
    kind,
    propertyAddress: address,
    summary: changes ? describeChanges(changes) : null,
    reason,
    reviewUrl: `${origin}/en/admin/listings/${propertyId}/review`,
    requestId: created.id,
  });

  return json({ id: created.id, status: "pending" }, 201);
}
