// POST /api/agreement/create
// Body (JSON): { property_id, lang? }
//
// Creates a DocuSign envelope from the Lixtara Listing Agreement template
// for the seller, persists an `agreements` row, and returns the embedded
// signing URL the client redirects to.
//
// On first invocation in a fresh DocuSign account this fails with a
// consent_required error — the response surfaces the consent URL the user
// must visit ONCE to grant impersonation. After that, JWT auth works.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createEnvelopeFromTemplate,
  getRecipientView,
} from "@/lib/docusign";
import { PRICING_TIERS, type PricingTierId } from "@/lib/pricing-tiers";

interface Body {
  property_id?: string;
  lang?: string;
}

export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const propertyId = body.property_id;
  const lang = body.lang === "es" ? "es" : "en";
  if (!propertyId) {
    return NextResponse.json({ error: "property_id_required" }, { status: 400 });
  }

  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, owner_id, pricing_tier, mls_status, address_street, address_city, address_state, address_zip, list_price, bedrooms, bathrooms, sqft, year_built, folio, legal_description, has_pool, buyer_agent_commission, property_type",
    )
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!property) {
    return NextResponse.json(
      { error: "property_not_found_or_not_yours" },
      { status: 404 },
    );
  }
  if (property.mls_status !== "draft") {
    return NextResponse.json(
      { error: "property_not_in_draft", status: property.mls_status },
      { status: 409 },
    );
  }

  // Reuse any in-flight envelope so we don't create duplicates on retry.
  const { data: existing } = await supabase
    .from("agreements")
    .select("id, envelope_id, status, signer_email, signer_name")
    .eq("property_id", propertyId)
    .in("status", ["pending", "sent", "delivered", "signed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const templateId = process.env.DOCUSIGN_LISTING_AGREEMENT_TEMPLATE_ID;
  if (!templateId) {
    return NextResponse.json(
      { error: "template_not_configured" },
      { status: 500 },
    );
  }

  // The signer's profile name comes from public.users (Lovable schema).
  const { data: profile } = await supabase
    .from("users")
    .select("first_name, last_name")
    .eq("id", user.id)
    .maybeSingle();
  const signerName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
    user.email;
  const signerEmail = user.email;

  const origin = new URL(req.url).origin;
  const returnUrl = `${origin}/${lang}/listing/new?step=7&id=${propertyId}&signed=1`;

  try {
    let envelopeId = existing?.envelope_id ?? null;
    let agreementRowId = existing?.id ?? null;

    if (!envelopeId) {
      // Pre-fill every field DocuSign asks for. Template should expose tabs
      // with these labels — extras silently ignored if the template doesn't
      // bind them yet (DocuSign is lenient on unknown tab labels).
      const tierId = (property.pricing_tier ?? "pro") as PricingTierId;
      const tier = PRICING_TIERS[tierId] ?? PRICING_TIERS.pro;
      const tierName = tierId.charAt(0).toUpperCase() + tierId.slice(1);
      const buyerPct = Number(property.buyer_agent_commission ?? 0);
      const tabs: Record<string, string> = {
        property_address: `${property.address_street}, ${property.address_city}, ${property.address_state} ${property.address_zip}`,
        property_street: property.address_street ?? "",
        property_city: property.address_city ?? "",
        property_state: property.address_state ?? "FL",
        property_zip: property.address_zip ?? "",
        list_price: `$${property.list_price.toLocaleString()}`,
        list_price_numeric: String(property.list_price ?? 0),
        pricing_tier: tierName,
        seller_flat_fee: `$${tier.flatFee}`,
        seller_commission_pct: `${tier.commissionPct}%`,
        buyer_agent_commission_pct: `${buyerPct}%`,
        seller_name: signerName,
        seller_email: signerEmail,
        bedrooms: String(property.bedrooms ?? ""),
        bathrooms: String(property.bathrooms ?? ""),
        sqft: String(property.sqft ?? ""),
        year_built: String(property.year_built ?? ""),
        property_type: property.property_type ?? "",
        has_pool: property.has_pool ? "Yes" : "No",
        folio: property.folio ?? "",
        legal_description: property.legal_description ?? "",
        listing_term_months: String(tier.termMonths ?? 24),
        signing_date: new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
      };

      const created = await createEnvelopeFromTemplate({
        templateId,
        // The template must have a role with this exact name. If the
        // template uses a different role name, we surface the DocuSign
        // error verbatim.
        signerRole: "Seller",
        signerEmail,
        signerName,
        clientUserId: propertyId,
        textTabs: tabs,
        emailSubject: "Lixtara listing agreement — please sign",
      });
      envelopeId = created.envelopeId;

      const { data: inserted, error: insErr } = await supabase
        .from("agreements")
        .insert({
          property_id: propertyId,
          owner_id: user.id,
          vendor: "docusign",
          template_id: templateId,
          envelope_id: envelopeId,
          status: "sent",
          signer_email: signerEmail,
          signer_name: signerName,
        })
        .select("id")
        .single();
      if (insErr) {
        console.error("agreements insert failed:", JSON.stringify(insErr));
      }
      agreementRowId = inserted?.id ?? null;
    }

    const view = await getRecipientView({
      envelopeId,
      signerEmail,
      signerName,
      clientUserId: propertyId,
      returnUrl,
    });

    return NextResponse.json({
      url: view.url,
      envelope_id: envelopeId,
      agreement_id: agreementRowId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json(
      { error: "docusign_failed", detail: msg },
      { status: 502 },
    );
  }
}
