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
import { BROKERAGE_LICENSED_ENTITY } from "@/lib/broker";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";
import { APPLIANCE_KEYS, sanitizeAppliances } from "@/lib/appliances";
import { t } from "@/lib/i18n";

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

  // Each call may mint a DocuSign envelope + JWT exchange — cap per user.
  const limited = await enforceLimit(
    apiLimiter("agreement:create", 20, "1 h"),
    `u:${user.id}`,
    {
      label: "agreement:create",
      message:
        "Too many agreement attempts. Please wait a few minutes and try again.",
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
  const lang = body.lang === "es" ? "es" : "en";
  if (!propertyId) {
    return NextResponse.json({ error: "property_id_required" }, { status: 400 });
  }

  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, owner_id, pricing_tier, mls_status, address_street, address_city, address_state, address_zip, list_price, legal_description, buyer_agent_commission, has_pool, bedrooms, bathrooms, sqft, year_built, cash_only, as_is_sale, property_type, folio, lot_size, parking_spaces, hoa_fee, tax_annual_amount, flood_zone, occupancy_status, monthly_rent, lease_end_date, tenant_cooperation, description, appliances",
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
      // Labels MUST match the tabLabel values defined on the DocuSign
      // template (Seller role). Verified via scripts/check-docusign-template.ts
      // against the Lixtara Listing Agreement template
      // (f9f29faf-d151-4975-a3ce-14a4ac1b5117). DocuSign silently ignores
      // any tabLabel that the template doesn't bind.
      const tierId = (property.pricing_tier ?? "pro") as PricingTierId;
      const tier = PRICING_TIERS[tierId] ?? PRICING_TIERS.pro;
      const buyerPct = Number(property.buyer_agent_commission ?? 0);

      const today = new Date();
      const startDate = today.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const terminationDate = new Date(today);
      terminationDate.setMonth(
        terminationDate.getMonth() + (tier.termMonths ?? 24),
      );
      const terminationDateStr = terminationDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      const fullAddress = `${property.address_street}, ${property.address_city}, ${property.address_state} ${property.address_zip}`;

      // Formatters so every value lands human-readable on the contract.
      const yn = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : "");
      const money = (v: unknown) =>
        v != null && Number.isFinite(Number(v)) && Number(v) > 0
          ? `$${Number(v).toLocaleString()}`
          : "";
      const num = (v: unknown) =>
        v != null && Number.isFinite(Number(v)) ? Number(v).toLocaleString() : "";
      const PROPERTY_TYPE_LABEL: Record<string, string> = {
        single_family: "Single Family",
        condo: "Condominium",
        townhouse: "Townhouse",
        multi_family: "Multi-Family",
      };
      const OCCUPANCY_LABEL: Record<string, string> = {
        vacant: "Vacant",
        owner_occupied: "Owner-occupied",
        tenant_occupied: "Tenant-occupied",
      };

      // Personal property: appliances the seller includes with the sale,
      // rendered as a human-readable list in the contract's Personal Property
      // clause. Labels are the canonical English names (the contract is EN).
      const applianceLabels = t("en").listingForm.step3.appliances as Record<
        string,
        string
      >;
      const includedAppliances = sanitizeAppliances(
        (property.appliances ?? []) as string[],
      );
      const personalProperty = APPLIANCE_KEYS.filter((k) =>
        includedAppliances.includes(k),
      )
        .map((k) => applianceLabels[k])
        .join(", ");

      // Lockbox is part of the engagement on Concierge (always) and Pro (when
      // the home is vacant). Essentials buys it as a $60 add-on — not included.
      const lockboxIncluded =
        tierId === "concierge" ||
        (tierId === "pro" && property.occupancy_status === "vacant");

      // EVERY seller-entered + Miami-Dade-sourced field is sent so the contract
      // reaches the seller fully pre-populated — only awaiting signature.
      // DocuSign silently ignores any tabLabel the template doesn't bind, so
      // the template must define a text field per label below to display it.
      // Keep this list in sync with scripts/check-docusign-template.ts.
      const tabs: Record<string, string> = {
        // ── Property: identity ──
        street_address: fullAddress,
        city: property.address_city ?? "",
        state: property.address_state ?? "",
        zip: property.address_zip ?? "",
        folio: property.folio ?? "",
        legal_description: property.legal_description ?? "",
        property_type:
          PROPERTY_TYPE_LABEL[property.property_type ?? ""] ??
          property.property_type ??
          "",
        // ── Property: characteristics ──
        bedrooms: property.bedrooms != null ? String(property.bedrooms) : "",
        bathrooms: property.bathrooms != null ? String(property.bathrooms) : "",
        sqft: num(property.sqft),
        lot_size: num(property.lot_size),
        year_built:
          property.year_built != null ? String(property.year_built) : "",
        parking_spaces:
          property.parking_spaces != null
            ? String(property.parking_spaces)
            : "",
        pool: yn(property.has_pool),
        flood_zone: property.flood_zone ?? "",
        property_description: property.description ?? "",
        // ── Financial ──
        list_price: `$${property.list_price.toLocaleString()}`,
        hoa_fee: money(property.hoa_fee),
        tax_annual: money(property.tax_annual_amount),
        cash_only: yn(property.cash_only),
        as_is_sale: yn(property.as_is_sale),
        // ── Occupancy / tenancy ──
        occupancy_status:
          OCCUPANCY_LABEL[property.occupancy_status ?? ""] ??
          property.occupancy_status ??
          "",
        monthly_rent: money(property.monthly_rent),
        lease_end_date: property.lease_end_date ?? "",
        tenant_cooperation: property.tenant_cooperation ?? "",
        // ── Personal property ──
        personal_property: personalProperty,
        // ── Parties ──
        seller_name: signerName,
        broker_name: BROKERAGE_LICENSED_ENTITY,
        // ── Economics (Lixtara plan) ──
        flat_fee: `$${tier.flatFee}`,
        commission_pct: `${tier.commissionPct}%`,
        buyer_agent_commission: `${buyerPct}%`,
        // ── Term ──
        start_date: startDate,
        termination_date: terminationDateStr,
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
        // System-set economics — the signer must not edit these (they reflect
        // the selected plan exactly). Rendered read-only on the contract.
        lockedTextTabs: ["commission_pct", "flat_fee", "buyer_agent_commission"],
        // Checkbox tabs (template must bind these labels on the Seller role):
        //  • lockbox_authorized → contract line 71, item E — checked only when
        //    the plan includes a lockbox.
        //  • buyer_commission_ack → contract line 145, item A — always checked
        //    (the seller agrees to publish a buyer-agent commission).
        checkboxTabs: {
          lockbox_authorized: lockboxIncluded,
          buyer_commission_ack: true,
        },
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
