// POST /api/webhooks/tour
//
// Callback sink for ASYNC/webhook tour engines (future, e.g. Replicate). The
// default engine (Veo / gemini-video) is SYNCHRONOUS and finishes inside
// /api/tours/submit, so this route is normally unused — it acks. When an async
// engine is selected, its parseCallback() maps the inbound payload to a
// tour_jobs update (matched by vendor_job_id).
//
// REQUIRES migration 20260617170413_tour_jobs_generalize.sql (vendor_job_id /
// output_path columns).

import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getTourProcessor } from "@/lib/tour";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase service env vars missing");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 200 });
  }

  const processor = getTourProcessor();
  if (processor.mode !== "webhook" || !processor.parseCallback) {
    // Synchronous engine (Veo) — no webhooks expected. Ack so the sender stops.
    return NextResponse.json({ ok: true, note: "engine_is_synchronous" });
  }

  const result = processor.parseCallback(body);
  if (!result.vendorJobId || result.vendorJobId === "unknown") {
    return NextResponse.json(
      { ok: false, error: "no_vendor_job_id" },
      { status: 200 },
    );
  }

  const svc = serviceClient();
  const update: Record<string, unknown> = { status: result.status };
  if (result.status === "ready") {
    update.output_path = result.outputUrl ?? null;
    update.completed_at = new Date().toISOString();
  } else {
    update.error_message = result.error ?? "failed";
  }
  await svc
    .from("tour_jobs")
    .update(update)
    .eq("vendor_job_id", result.vendorJobId);

  return NextResponse.json({ ok: true, status: result.status });
}
