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
import { createService } from "@/lib/supabase/service";
import {
  createEnvelopeFromTemplate,
  getRecipientView,
  LIXTARA_BROKER_ROLE,
} from "@/lib/docusign";
import { PRICING_TIERS, type PricingTierId } from "@/lib/pricing-tiers";
import { offerFromRow, offerWithinLimit } from "@/lib/buyer-comp";
import { fetchBuyerComp } from "@/lib/buyer-comp.server";
import { BROKERAGE_LICENSED_ENTITY } from "@/lib/broker";
import { brokerSigner } from "@/config/brokerage";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";
import { t } from "@/lib/i18n";
import { CONSENTS } from "@/lib/legal/consents";
import { recordAcceptance } from "@/lib/legal/consents.server";
import { loadFirstIncompleteStep } from "@/lib/listing-completeness.server";
import { verifiedLegalDescription } from "@/lib/miami-dade";
import { recordAgreementSent } from "@/lib/agreement-legal.server";
import { attachmentHtml, listingAgreementTabs } from "@/lib/docusign/listing-agreement-tabs";

interface Body {
  property_id?: string;
  lang?: string;
  /** Aviso y casilla E-SIGN del paso 7 (src/lib/legal/consents.ts), en su versión vigente. */
  accept_esign?: unknown;
  esign_version?: unknown;
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
  // Consentimiento E-SIGN antes de abrir DocuSign: obligatorio y en la versión vigente.
  if (body.accept_esign !== true) {
    return NextResponse.json({ error: "esign_consent_required" }, { status: 400 });
  }
  if (body.esign_version !== CONSENTS.esign.version) {
    return NextResponse.json({ error: "esign_consent_outdated" }, { status: 409 });
  }

  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, owner_id, pricing_tier, mls_status, address_street, address_city, address_state, address_zip, list_price, legal_description, has_pool, bedrooms, bathrooms, sqft, year_built, cash_only, financing_terms, financing_other, as_is_sale, property_type, folio, lot_size, parking_spaces, hoa_fee, tax_annual_amount, flood_zone, occupancy_status, monthly_rent, lease_end_date, tenant_cooperation, description, appliances",
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

  // Sin acuerdo para un listing incompleto (pasos 1–5 vacíos, p. ej. llegando por URL al paso
  // 7): de vuelta al primer paso pendiente. El paso 6 lo cubre la comprobación de la oferta,
  // con su propio mensaje. Si no se puede comprobar, no se arma el contrato.
  let firstIncomplete: number | null;
  try {
    firstIncomplete = await loadFirstIncompleteStep(supabase, property.id);
  } catch (err) {
    console.error("agreement/create: completeness check failed", err);
    return NextResponse.json({ error: "completeness_check_failed" }, { status: 500 });
  }
  if (firstIncomplete !== null && firstIncomplete < 6) {
    return NextResponse.json(
      {
        error: "listing_incomplete",
        step: firstIncomplete,
        redirect: `/${lang}/listing/new?step=${firstIncomplete}&id=${encodeURIComponent(property.id)}`,
      },
      { status: 409 },
    );
  }

  // La oferta al agente del comprador se elige en el paso 6 (0% es válido). Sin elección no
  // se arma un contrato con un valor que el vendedor no decidió. Se lee con la función (la
  // tabla no expone esas columnas a la API); si falla, no se arma el contrato.
  let buyerOffer;
  try {
    buyerOffer = offerFromRow(await fetchBuyerComp(supabase, property.id));
  } catch (err) {
    console.error("agreement/create: buyer comp read failed", err);
    return NextResponse.json({ error: "buyer_comp_read_failed" }, { status: 500 });
  }
  // Sin elección, o con una oferta que el precio de lista nuevo dejó por encima del tope de
  // Lixtara (3%, también para el monto fijo): de vuelta al paso 6.
  const step6 = (code: string) =>
    `/${lang}/listing/new?step=6&id=${encodeURIComponent(property.id)}&error=${code}`;
  if (!buyerOffer) {
    return NextResponse.json({ error: "buyer_comp_not_set", redirect: step6("buyer_comp_choice_required") }, { status: 409 });
  }
  if (!offerWithinLimit(buyerOffer, Number(property.list_price))) {
    return NextResponse.json({ error: "buyer_comp_over_limit", redirect: step6("buyer_comp_over_limit") }, { status: 409 });
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

  // Prueba del consentimiento E-SIGN (IP, user agent, versión, hash del texto). Sin ella no
  // se abre DocuSign.
  const esignRecorded = await recordAcceptance({
    document: "esign",
    lang,
    context: "step7_esign",
    userId: user.id,
    propertyId,
    headers: req.headers,
  });
  if (!esignRecorded) {
    return NextResponse.json({ error: "consent_record_failed" }, { status: 503 });
  }

  const origin = new URL(req.url).origin;
  const returnUrl = `${origin}/${lang}/listing/new?step=7&id=${propertyId}&signed=1`;

  try {
    let envelopeId = existing?.envelope_id ?? null;
    let agreementRowId = existing?.id ?? null;

    if (!envelopeId) {
      // Sin el email de firma de la broker no se crea ningún sobre (#137 f).
      const broker = brokerSigner();
      if (!broker) {
        console.error(JSON.stringify({ event: "docusign_broker_signer_missing", propertyId }));
        return NextResponse.json({ error: "broker_signer_not_configured" }, { status: 503 });
      }

      // Every value, its line on the form and the rules (legal description only verified
      // with the county, "See Attachment", occupancy as one choice…): listingAgreementTabs and
      // docs/docusign/field-map-ers21tn.md. DocuSign silently ignores a tabLabel the template
      // doesn't bind: scripts/check-docusign-template.ts compares both.
      const tierId = (property.pricing_tier ?? "pro") as PricingTierId;
      const tier = PRICING_TIERS[tierId] ?? PRICING_TIERS.pro;
      // Re-checked with the county now; if it can't be verified the contract says "See Attachment".
      const verifiedLegal = await verifiedLegalDescription(property).catch(() => null);
      const contract = listingAgreementTabs({
        listing: property,
        tier,
        sellerName: signerName,
        brokerName: BROKERAGE_LICENSED_ENTITY,
        buyerOffer,
        verifiedLegal,
        applianceLabels: t("en").listingForm.step3.appliances as Record<string, string>,
        today: new Date(),
      });
      const propertyLine = `${property.address_street}, ${contract.text.city_state_zip}`;

      const created = await createEnvelopeFromTemplate({
        templateId,
        // The template must have a role with this exact name. If the
        // template uses a different role name, we surface the DocuSign
        // error verbatim.
        signerRole: "Seller",
        signerEmail,
        signerName,
        clientUserId: propertyId,
        // La broker contrafirma después del vendedor (routingOrder 2) (#137 f).
        brokerSigner: { roleName: LIXTARA_BROKER_ROLE.listingAgreement, ...broker },
        textTabs: contract.text,
        // Lo que puso el sitio (precio, dirección, nombres, fechas, plan, comisión) no se edita
        // en DocuSign.
        lockedTextTabs: contract.lockedText,
        checkboxTabs: contract.checkbox,
        lockedCheckboxTabs: contract.lockedCheckbox,
        radioGroupTabs: contract.radio,
        attachments:
          contract.attachment.length > 0
            ? [{ name: "Attachment to Listing Agreement", html: attachmentHtml(contract.attachment, propertyLine) }]
            : undefined,
        emailSubject: "Please sign your Lixtara listing agreement",
      });
      envelopeId = created.envelopeId;

      // Con la clave de servicio: el vendedor solo puede insertar 'pending' (política RLS de
      // 20261021120000); 'verified' lo pone el servidor tras verificar con el condado. Ya se
      // comprobó arriba que el listing es suyo y está en borrador.
      const { data: inserted, error: insErr } = await createService()
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
          // Sin descripción legal verificada, el admin no puede aprobar el listing (#217).
          legal_description_status: contract.legalStatus,
        })
        .select("id")
        .single();
      if (insErr) {
        console.error("agreements insert failed:", JSON.stringify(insErr));
      }
      agreementRowId = inserted?.id ?? null;
      // Auditoría (el bloqueo lee agreements.legal_description_status).
      await recordAgreementSent({ propertyId, userId: user.id, envelopeId, legal: contract.legalStatus });
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
