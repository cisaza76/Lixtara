// POST /api/tours/submit  — body: { property_id, photo_id }
//
// "Living Listing": turn a REAL listing photo into a subtle cinematic micro-clip
// via the selected TourProcessor (default Veo / gemini-video). Writes a
// tour_jobs row; for synchronous engines it also uploads the result and flips
// the job to "ready". The engine is chosen by TOUR_ENGINE via getTourProcessor()
// — this route never imports a specific engine.
//
// REQUIRES migration 20260617170413_tour_jobs_generalize.sql (vendor_job_id /
// output_path / tour_kind columns + relaxed vendor CHECK) — apply with sign-off.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getTourProcessor } from "@/lib/tour";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";

// Veo image-to-video runs ~1–3 min; allow the synchronous engine to finish.
export const maxDuration = 300;

const BUCKET = "tour-videos";

interface Body {
  property_id?: string;
  photo_id?: string;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase service env vars missing");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  // Video generation costs real money — cap tightly.
  const limited = await enforceLimit(
    apiLimiter("tours:submit", 5, "1 h"),
    `u:${user.id}`,
    {
      label: "tours:submit",
      message: "Too many tour requests. Please wait a few minutes and try again.",
    },
  );
  if (limited) return limited;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const propertyId = body.property_id;
  const photoId = body.photo_id;
  if (!propertyId || !photoId) {
    return NextResponse.json(
      { error: "property_id_and_photo_id_required" },
      { status: 400 },
    );
  }

  // Ownership + the source photo (RLS: user can only read their own photos).
  const { data: property } = await supabase
    .from("properties")
    .select("id, owner_id")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!property) {
    return NextResponse.json(
      { error: "property_not_found_or_not_yours" },
      { status: 404 },
    );
  }
  const { data: photo } = await supabase
    .from("property_photos")
    .select("id, url, property_id")
    .eq("id", photoId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!photo || !photo.url) {
    return NextResponse.json({ error: "photo_not_found" }, { status: 404 });
  }

  const svc = serviceClient();
  const processor = getTourProcessor();

  const { data: job, error: jobErr } = await svc
    .from("tour_jobs")
    .insert({
      property_id: propertyId,
      owner_id: user.id,
      vendor: processor.id,
      tour_kind: processor.kind,
      status: "processing",
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (jobErr || !job) {
    return NextResponse.json(
      { error: "job_create_failed", detail: jobErr?.message ?? "no row" },
      { status: 502 },
    );
  }
  const jobId = job.id as string;
  const origin = new URL(req.url).origin;

  try {
    const result = await processor.start({
      jobId,
      propertyId,
      imageUrl: photo.url,
      callbackUrl: `${origin}/api/webhooks/tour`,
    });

    if (result.status === "ready" && result.bytes) {
      const path = `${propertyId}/living-listing/${jobId}.mp4`;
      const { error: upErr } = await svc.storage
        .from(BUCKET)
        .upload(path, result.bytes, {
          contentType: result.mimeType ?? "video/mp4",
          upsert: true,
        });
      if (upErr) {
        await svc
          .from("tour_jobs")
          .update({
            status: "failed",
            error_message: `upload: ${upErr.message}`,
            vendor_job_id: result.vendorJobId,
          })
          .eq("id", jobId);
        return NextResponse.json(
          { error: "storage_upload_failed", detail: upErr.message },
          { status: 502 },
        );
      }
      await svc
        .from("tour_jobs")
        .update({
          status: "ready",
          vendor_job_id: result.vendorJobId,
          output_path: path,
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      const { data: signed } = await svc.storage
        .from(BUCKET)
        .createSignedUrl(path, 60 * 60);
      return NextResponse.json({
        job_id: jobId,
        status: "ready",
        video_url: signed?.signedUrl ?? null,
      });
    }

    if (result.status === "failed") {
      await svc
        .from("tour_jobs")
        .update({
          status: "failed",
          error_message: result.error ?? "failed",
          vendor_job_id: result.vendorJobId,
        })
        .eq("id", jobId);
      return NextResponse.json(
        { job_id: jobId, status: "failed", error: result.error },
        { status: 502 },
      );
    }

    // "processing": async engine (webhook will finish it) or a sync engine that
    // timed out within this request (a future poll route can resume).
    await svc
      .from("tour_jobs")
      .update({ status: "processing", vendor_job_id: result.vendorJobId })
      .eq("id", jobId);
    return NextResponse.json({ job_id: jobId, status: "processing" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "tour_error";
    await svc
      .from("tour_jobs")
      .update({ status: "failed", error_message: msg })
      .eq("id", jobId);
    return NextResponse.json(
      { error: "tour_generation_failed", detail: msg },
      { status: 502 },
    );
  }
}
