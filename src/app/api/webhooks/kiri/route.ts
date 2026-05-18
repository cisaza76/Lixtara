// POST /api/webhooks/kiri
// KIRI calls us with `{ serialize, status }` when a tour job changes state.
// On 'ready' we fetch the .ply within KIRI's 3-day retention window and
// persist it to Supabase Storage. We always respond 200 so KIRI doesn't
// retry indefinitely — failures are logged on the row so the seller dash
// can show them.
//
// Important: this route uses the service-role Supabase client because the
// webhook is unauthenticated. KIRI doesn't (yet) document the exact signing
// header; if KIRI_WEBHOOK_SECRET is set we verify HMAC-SHA256(body, secret)
// against the `x-kiri-signature` header (best guess). Without a secret we
// trust the request — fine until KIRI confirms the signing scheme.

import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getJobStatus, type KiriStatus, verifyWebhookSignature } from "@/lib/kiri";

interface KiriWebhookPayload {
  serialize?: string;
  status?: number;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase service env vars missing");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

async function downloadAndStore(
  modelUrl: string,
  storagePath: string,
): Promise<{ size: number }> {
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`KIRI model fetch ${res.status}`);
  const buf = await res.arrayBuffer();
  const supabase = serviceClient();
  const { error } = await supabase.storage
    .from("tour-models")
    .upload(storagePath, buf, {
      contentType: "application/zip",
      upsert: true,
    });
  if (error) throw new Error(`Supabase storage upload: ${error.message}`);
  return { size: buf.byteLength };
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  const secret = process.env.KIRI_WEBHOOK_SECRET;
  if (secret) {
    const sigHeader = req.headers.get("x-kiri-signature");
    const valid = await verifyWebhookSignature(rawBody, sigHeader, secret);
    if (!valid) {
      return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 401 });
    }
  }

  let payload: KiriWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as KiriWebhookPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 200 });
  }
  if (!payload.serialize) {
    return NextResponse.json({ ok: false, error: "no_serialize" }, { status: 200 });
  }

  const supabase = serviceClient();
  const { data: job } = await supabase
    .from("tour_jobs")
    .select("id, property_id, status")
    .eq("kiri_task_id", payload.serialize)
    .maybeSingle();
  if (!job) {
    // We don't know this task — KIRI may be calling for a job from another env
    // (preview/prod share the same KIRI account during F4 dev). Ack and move on.
    return NextResponse.json({ ok: true, note: "unknown_serialize" });
  }

  // Re-derive state from KIRI — payload.status int isn't trustworthy.
  // getJobStatus internally hits getModelZip which returns either a usable
  // modelUrl (= ready) or a documented envelope code for every other state.
  let kiriStatus: KiriStatus = "unknown";
  let modelUrl: string | null = null;
  try {
    const fresh = await getJobStatus(payload.serialize);
    kiriStatus = fresh.status;
    modelUrl = fresh.modelUrl;
  } catch {
    // fall through with unknown — recorded below
  }

  if (kiriStatus === "ready" && modelUrl) {
    try {
      const storagePath = `${job.property_id}/${payload.serialize}.zip`;
      const { size } = await downloadAndStore(modelUrl, storagePath);
      await supabase
        .from("tour_jobs")
        .update({
          status: "ready",
          ply_storage_path: storagePath,
          ply_size_bytes: size,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "download_failed";
      await supabase
        .from("tour_jobs")
        .update({ status: "failed", error_message: msg })
        .eq("id", job.id);
    }
  } else if (kiriStatus === "failed" || kiriStatus === "expired") {
    await supabase
      .from("tour_jobs")
      .update({
        status: kiriStatus,
        error_message: `KIRI reported ${kiriStatus}`,
      })
      .eq("id", job.id);
  } else if (kiriStatus === "queued" || kiriStatus === "processing") {
    await supabase
      .from("tour_jobs")
      .update({ status: kiriStatus })
      .eq("id", job.id);
  }

  return NextResponse.json({ ok: true });
}
