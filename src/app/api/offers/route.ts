// POST /api/offers
// Body (JSON): { property_id, offer_amount, earnest_deposit?, financing_type,
//                closing_date?, expiration_at?, contingencies[]?, message? }
//
// Persists a new offers row (RLS gates buyer_id = auth.uid()), then fires
// a notification email to the seller (best-effort).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const VALID_FINANCING = new Set([
  "cash",
  "conventional",
  "fha",
  "va",
  "other",
]);

interface Body {
  property_id?: string;
  offer_amount?: number;
  earnest_deposit?: number | null;
  financing_type?: string;
  closing_date?: string | null;
  expiration_at?: string | null;
  contingencies?: string[];
  message?: string | null;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
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

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const propertyId = body.property_id;
  const amount = Number(body.offer_amount);
  const financing = String(body.financing_type ?? "").toLowerCase();
  if (!propertyId) {
    return NextResponse.json({ error: "property_id_required" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }
  if (!VALID_FINANCING.has(financing)) {
    return NextResponse.json({ error: "invalid_financing" }, { status: 400 });
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, owner_id, mls_status, address_street, address_city, address_state, address_zip")
    .eq("id", propertyId)
    .maybeSingle();
  if (!property) {
    return NextResponse.json({ error: "property_not_found" }, { status: 404 });
  }
  if (property.owner_id === user.id) {
    return NextResponse.json({ error: "cannot_offer_on_own_property" }, { status: 409 });
  }
  if (property.mls_status !== "active") {
    return NextResponse.json(
      { error: "property_not_active", status: property.mls_status },
      { status: 409 },
    );
  }

  const earnest = body.earnest_deposit != null
    ? Number(body.earnest_deposit)
    : null;
  const cleanContingencies = Array.isArray(body.contingencies)
    ? body.contingencies.filter((c) => typeof c === "string").slice(0, 10)
    : [];
  const message = typeof body.message === "string"
    ? body.message.slice(0, 2000).trim() || null
    : null;

  const { data: insertedOffer, error: insErr } = await supabase
    .from("offers")
    .insert({
      property_id: propertyId,
      buyer_id: user.id,
      seller_id: property.owner_id,
      offer_amount: amount,
      earnest_deposit: earnest,
      financing_type: financing,
      closing_date: body.closing_date || null,
      expiration_at: body.expiration_at || null,
      contingencies: cleanContingencies,
      message,
      status: "pending",
    })
    .select("id")
    .single();
  if (insErr || !insertedOffer) {
    return NextResponse.json(
      { error: "offer_insert_failed", detail: insErr?.message },
      { status: 500 },
    );
  }

  // Best-effort seller notification. Uses service-role to fetch the seller's
  // email since RLS doesn't allow cross-user lookups.
  try {
    const sc = serviceClient();
    if (sc) {
      const { data: sellerAuth } = await sc.auth.admin.getUserById(
        property.owner_id,
      );
      const sellerEmail = sellerAuth.user?.email;
      const apiKey = process.env.RESEND_API_KEY;
      if (sellerEmail && apiKey) {
        const overrideTo = process.env.EMAIL_DEV_OVERRIDE_TO ?? sellerEmail;
        const resend = new Resend(apiKey);
        const address = `${property.address_street}, ${property.address_city}, ${property.address_state} ${property.address_zip}`;
        const origin =
          process.env.NEXT_PUBLIC_SITE_URL ?? "https://lixtara.vercel.app";
        const subject = `New offer on ${property.address_street} — $${amount.toLocaleString()}`;
        await resend.emails.send({
          from: "Lixtara <onboarding@resend.dev>",
          to: overrideTo,
          subject,
          html: `<p>You received a new offer.</p>
                 <p><strong>Address:</strong> ${address}<br>
                    <strong>Offer:</strong> $${amount.toLocaleString()}<br>
                    <strong>Financing:</strong> ${financing}</p>
                 ${message ? `<p><em>"${message.replace(/</g, "&lt;")}"</em></p>` : ""}
                 <p><a href="${origin}/en/dashboard">Open your dashboard →</a></p>`,
          text: `New offer received for ${address}: $${amount.toLocaleString()} (${financing}).${message ? `\n\nMessage: ${message}` : ""}\n\n${origin}/en/dashboard`,
        });
      }
    }
  } catch (e) {
    console.error("offer notify email failed", e);
  }

  return NextResponse.json({ offer_id: insertedOffer.id });
}
