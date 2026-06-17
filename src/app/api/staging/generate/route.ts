// POST /api/staging/generate  — body: { photo_id, style }
//
// Flow:
//   1. Auth + rate-limit + validate style.
//   2. Load original photo (RLS enforces seller owns it via property).
//   3. Call Luma uni-1 image_edit with the curated prompt for the chosen
//      style and the original photo's public URL.
//   4. Poll Luma until completed (~30-90s typical, 4 min timeout).
//   5. Download the result image from Luma's CDN.
//   6. Upload it to our property-photos bucket via the service client.
//   7. Insert a new property_photos row: is_staged=true,
//      staging_status='approved', original_photo_id=<orig>.
//   8. Return the new photo to the client.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { startImageEdit, waitForCompletion } from "@/lib/luma";
import {
  promptFor,
  isStagingStyle,
  STAGING_FREE_QUOTA,
  STAGING_OVERAGE_PRICE,
} from "@/lib/staging";
import { getStagingBalance, consumeStagingCredit } from "@/lib/staging-credits";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";

const BUCKET = "property-photos";

interface Body {
  photo_id?: string;
  style?: string;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new Error("supabase service credentials not configured");
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

  // 10 staging calls/hour/user — each one costs real Luma credits.
  const limited = await enforceLimit(
    apiLimiter("staging:generate", 10, "1 h"),
    `u:${user.id}`,
    {
      label: "staging:generate",
      message: "Too many staging requests. Please wait a moment.",
    },
  );
  if (limited) return limited;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const photoId = body.photo_id;
  const style = String(body.style ?? "");
  if (!photoId) {
    return NextResponse.json({ error: "photo_id_required" }, { status: 400 });
  }
  if (!isStagingStyle(style)) {
    return NextResponse.json({ error: "invalid_style" }, { status: 400 });
  }

  // RLS check happens implicitly — user can only read property_photos for
  // properties they own. If photo isn't theirs, this returns null.
  const { data: photo } = await supabase
    .from("property_photos")
    .select("id, property_id, url")
    .eq("id", photoId)
    .maybeSingle();
  if (!photo || !photo.property_id || !photo.url) {
    return NextResponse.json(
      { error: "photo_not_found_or_not_yours" },
      { status: 404 },
    );
  }

  // Quota: STAGING_FREE_QUOTA free staged photos per listing. Beyond that the
  // action requires a purchased credit ($STAGING_OVERAGE_PRICE each). Check
  // availability BEFORE spending Luma credits; only consume AFTER a successful
  // generation so failures are never charged.
  const svc = serviceClient();
  const { count: stagedCount } = await svc
    .from("property_photos")
    .select("id", { count: "exact", head: true })
    .eq("property_id", photo.property_id)
    .eq("is_staged", true);
  const isOverage = (stagedCount ?? 0) >= STAGING_FREE_QUOTA;
  if (isOverage) {
    const balance = await getStagingBalance(svc, user.id);
    if (balance.remaining <= 0) {
      return NextResponse.json(
        {
          error: "staging_payment_required",
          free_quota: STAGING_FREE_QUOTA,
          price_per_action: STAGING_OVERAGE_PRICE,
        },
        { status: 402 },
      );
    }
  }

  // 1. Submit to Luma + wait for the edited image URL.
  let resultUrl: string;
  try {
    const gen = await startImageEdit({
      prompt: promptFor(style),
      sourceUrl: photo.url,
      model: "uni-1",
    });
    const completed = await waitForCompletion(gen.id);
    const u = completed.output?.[0]?.url;
    if (!u) throw new Error("Luma returned no output URL");
    resultUrl = u;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "luma_error";
    return NextResponse.json(
      { error: "luma_generation_failed", detail: msg },
      { status: 502 },
    );
  }

  // 2. Download result image bytes from Luma CDN.
  let bytes: ArrayBuffer;
  let contentType: string;
  try {
    const r = await fetch(resultUrl);
    if (!r.ok) throw new Error(`download ${r.status}`);
    bytes = await r.arrayBuffer();
    contentType = r.headers.get("content-type") ?? "image/jpeg";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "download_error";
    return NextResponse.json(
      { error: "luma_download_failed", detail: msg },
      { status: 502 },
    );
  }

  // 3. Upload to our public bucket + create property_photos row.
  // Use service client because user-scoped RLS doesn't let us insert rows
  // with is_staged=true (admin gate); this is server-side, post-auth.
  const ext = contentType.includes("png") ? "png" : "jpg";
  const storagePath = `${photo.property_id}/staged-${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await svc.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: false });
  if (upErr) {
    return NextResponse.json(
      { error: "storage_upload_failed", detail: upErr.message },
      { status: 502 },
    );
  }
  const { data: pub } = svc.storage.from(BUCKET).getPublicUrl(storagePath);

  const { data: inserted, error: insErr } = await svc
    .from("property_photos")
    .insert({
      property_id: photo.property_id,
      url: pub.publicUrl,
      caption: `Virtually staged — ${style}`,
      is_staged: true,
      original_photo_id: photo.id,
      // Auto-approve in the POC — admin moderation page exists but is
      // off-path for this first ship; revisit if quality drifts.
      staging_status: "approved",
    })
    .select("id, url, is_staged, original_photo_id, staging_status")
    .single();
  if (insErr || !inserted) {
    return NextResponse.json(
      { error: "db_insert_failed", detail: insErr?.message ?? "no row" },
      { status: 502 },
    );
  }

  // Charge the overage credit only now that the staged photo exists.
  if (isOverage) {
    await consumeStagingCredit(svc, user.id);
  }

  return NextResponse.json({ photo: inserted, style });
}
