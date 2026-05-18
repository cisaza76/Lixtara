// POST /api/tours/submit
// Accepts: multipart form with `property_id` + `video` (≤500MB, ≤3min, ≤1080p).
// Stores raw upload in Supabase Storage bucket `tour-videos/{property_id}/{uuid}.mp4`,
// submits to KIRI Engine, creates a `tour_jobs` row with the returned task_id.
// Returns: { job_id, kiri_task_id }
//
// Constraints: only the property owner can submit. Pro/Concierge tier only.
// The video duration/resolution checks are best-effort (the seller's browser is
// expected to enforce them via the upload UI); server-side is just size cap.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { submitVideo } from "@/lib/kiri";

const MAX_BYTES = 500 * 1024 * 1024; // 500 MB
const ELIGIBLE_TIERS = new Set(["pro", "concierge"]);

export const maxDuration = 300;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const form = await req.formData();
  const propertyId = String(form.get("property_id") ?? "");
  const video = form.get("video");

  if (!propertyId || !(video instanceof File)) {
    return NextResponse.json(
      { error: "property_id_and_video_required" },
      { status: 400 },
    );
  }
  if (video.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "video_too_large", max_bytes: MAX_BYTES },
      { status: 400 },
    );
  }

  // Verify ownership + tier eligibility in a single round-trip.
  const { data: property, error: propErr } = await supabase
    .from("properties")
    .select("id, owner_id, pricing_tier")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (propErr || !property) {
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

  // Store the raw upload so we can re-submit if KIRI loses it within 3 days.
  const ext = (video.name.split(".").pop() ?? "mp4").toLowerCase();
  const storagePath = `${propertyId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadErr } = await supabase.storage
    .from("tour-videos")
    .upload(storagePath, video, {
      contentType: video.type || "video/mp4",
      upsert: false,
    });
  if (uploadErr) {
    return NextResponse.json(
      { error: "storage_upload_failed", detail: uploadErr.message },
      { status: 500 },
    );
  }

  const { data: job, error: jobInsertErr } = await supabase
    .from("tour_jobs")
    .insert({
      property_id: propertyId,
      owner_id: user.id,
      vendor: "kiri",
      status: "uploading",
      source_video_path: storagePath,
      source_video_size_bytes: video.size,
    })
    .select("id")
    .single();
  if (jobInsertErr || !job) {
    return NextResponse.json(
      { error: "job_insert_failed", detail: jobInsertErr?.message },
      { status: 500 },
    );
  }

  // Hand off to KIRI. If submission fails we mark the job 'failed' so the
  // seller sees the error in their dashboard rather than the job hanging.
  try {
    const { serialize } = await submitVideo({
      videoBytes: video,
      filename: video.name || `tour-${propertyId}.${ext}`,
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
