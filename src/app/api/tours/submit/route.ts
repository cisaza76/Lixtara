// POST /api/tours/submit
// Body (JSON): { property_id: string, storage_path: string, size_bytes: number, filename: string }
//
// Client uploads the video directly to Supabase Storage (tour-videos bucket)
// to bypass Vercel's 4.5 MB platform body limit, then POSTs ONLY the path here.
// This endpoint then downloads the bytes from Storage server-side (no limit
// on internal fetches) and forwards as multipart to KIRI.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { submitVideo } from "@/lib/kiri";

const MAX_BYTES = 500 * 1024 * 1024;
const ELIGIBLE_TIERS = new Set(["pro", "concierge"]);

export const maxDuration = 300;

interface SubmitBody {
  property_id?: string;
  storage_path?: string;
  size_bytes?: number;
  filename?: string;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { property_id, storage_path, size_bytes, filename } = body;
  if (!property_id || !storage_path || !filename) {
    return NextResponse.json(
      { error: "property_id_storage_path_filename_required" },
      { status: 400 },
    );
  }
  if (size_bytes && size_bytes > MAX_BYTES) {
    return NextResponse.json(
      { error: "video_too_large", max_bytes: MAX_BYTES },
      { status: 400 },
    );
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, owner_id, pricing_tier")
    .eq("id", property_id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!property) {
    return NextResponse.json(
      { error: "property_not_found_or_not_yours" },
      { status: 404 },
    );
  }
  if (!ELIGIBLE_TIERS.has(property.pricing_tier ?? "")) {
    return NextResponse.json(
      { error: "tier_not_eligible", required: ["pro", "concierge"] },
      { status: 403 },
    );
  }

  // Create the job row first so the UI can poll status while we download.
  const { data: job, error: jobInsertErr } = await supabase
    .from("tour_jobs")
    .insert({
      property_id,
      owner_id: user.id,
      vendor: "kiri",
      status: "uploading",
      source_video_path: storage_path,
      source_video_size_bytes: size_bytes ?? null,
    })
    .select("id")
    .single();
  if (jobInsertErr || !job) {
    return NextResponse.json(
      { error: "job_insert_failed", detail: jobInsertErr?.message },
      { status: 500 },
    );
  }

  // Pull the video back from Supabase Storage (server-side, no Vercel cap on
  // internal fetches) and stream it to KIRI as multipart.
  const { data: videoBlob, error: dlErr } = await supabase.storage
    .from("tour-videos")
    .download(storage_path);
  if (dlErr || !videoBlob) {
    await supabase
      .from("tour_jobs")
      .update({ status: "failed", error_message: `download: ${dlErr?.message}` })
      .eq("id", job.id);
    return NextResponse.json(
      { error: "storage_download_failed", detail: dlErr?.message },
      { status: 502 },
    );
  }

  try {
    const { serialize } = await submitVideo({
      videoBytes: videoBlob,
      filename,
    });
    await supabase
      .from("tour_jobs")
      .update({
        status: "queued",
        kiri_task_id: serialize,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return NextResponse.json({ job_id: job.id, kiri_task_id: serialize });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    await supabase
      .from("tour_jobs")
      .update({ status: "failed", error_message: msg })
      .eq("id", job.id);
    return NextResponse.json(
      { error: "kiri_submit_failed", detail: msg, job_id: job.id },
      { status: 502 },
    );
  }
}
