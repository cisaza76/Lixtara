// Reenvío de validación de la API de Conversiones de Meta: SOLO Preview, SOLO staff (admin o
// broker), SOLO un listing is_test. Reenvía Lead, CompleteRegistration y Purchase con sus
// mismos event_id, lo guardado en ad_attribution y el código de Eventos de prueba dado, y
// devuelve la respuesta de Meta por evento. No guarda ni borra nada.
//
//   POST /api/meta/test-events  {"listing_id": "<uuid>", "test_event_code": "TEST12345"}
//
// Fuera de Preview responde 404 sin leer nada (ni la sesión).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isStaff } from "@/lib/admin-auth";
import { validTestEventCode } from "@/lib/meta-capi";
import { resendTestEvents } from "@/lib/meta-capi.server";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  if (process.env.VERCEL_ENV !== "preview") return new NextResponse(null, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isStaff(supabase))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const limited = await enforceLimit(apiLimiter("meta-test-events", 30, "1 h"), user.id, {
    message: "Too many requests",
    label: "meta-test-events",
  });
  if (limited) return limited;

  let body: { listing_id?: unknown; test_event_code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const listingId = typeof body.listing_id === "string" && UUID.test(body.listing_id) ? body.listing_id : null;
  const code = validTestEventCode(typeof body.test_event_code === "string" ? body.test_event_code : null);
  if (!listingId) return NextResponse.json({ error: "invalid_listing_id" }, { status: 400 });
  if (!code) return NextResponse.json({ error: "invalid_test_event_code", expected: "TEST + digits" }, { status: 400 });

  const result = await resendTestEvents(listingId, code);
  if (result === "not_allowed") {
    return NextResponse.json(
      { error: "not_allowed", detail: "The listing must exist and be is_test, and the CAPI must be enabled and configured in Preview." },
      { status: 409 },
    );
  }
  return NextResponse.json({ listing_id: listingId, test_event_code: code, events: result });
}
