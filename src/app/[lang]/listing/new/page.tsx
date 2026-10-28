import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import Link from "next/link";
import { isLocale, t, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createService } from "@/lib/supabase/service";
import { SITE_URL } from "@/lib/config";
import { apiLimiter } from "@/lib/ratelimit";
import { AccountGate } from "@/components/account-gate";
import { agreementSignedBySeller } from "@/lib/step-progress";
import { ListingEmailCode } from "@/components/listing-email-code";
import {
  cleanCodeInput,
  isCodeFormat,
  isValidEmail,
  normalizeEmail,
} from "@/lib/listing-email-gate";
import {
  emailTakenByAnotherUser,
  pendingChallengeEmail,
  recordLeadStep,
  startEmailChallenge,
  verifyEmailChallenge,
} from "@/lib/listing-email-gate.server";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { captchaTokenFrom, isCaptchaError } from "@/lib/turnstile";
import { StepShell } from "@/components/step-shell";
import {
  Field,
  SubmitButton,
  SecondaryButton,
  TextareaField,
  ErrorBanner,
  SuccessBanner,
} from "@/components/auth-shell";
import {
  PRICING_TIERS,
  TIER_ORDER,
  TRADITIONAL_COSTS,
  fillPricingCopy,
  fillTierCopy,
  isPricingTierId,
  type PricingTierId,
} from "@/lib/pricing-tiers";
import {
  improveListingDescription,
  improveShowingInstructions,
} from "@/lib/ai";
import { baseStreetForLookup, lookupMiamiDadeProperty, unitFromStoredStreet } from "@/lib/miami-dade";
import { fetchRentcastEstimate, type RentcastComp } from "@/lib/rentcast";
import { deletePropertyPhoto, storagePathFromUrl } from "@/lib/storage";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { countyForAddress, isMiamiDadeCounty, validateUsAddress } from "@/lib/geocode";
import { TourCoaching } from "@/components/tour-coaching";
import { PhotographyCheckoutButton } from "@/components/photography-checkout-button";
import { PhotoUploader } from "@/components/photo-uploader";
import { OccupancySection } from "@/components/occupancy-section";
import { APPLIANCE_KEYS, sanitizeAppliances } from "@/lib/appliances";
import { CheckAllToggle } from "@/components/check-all-toggle";
import { PhotoGridDraggable } from "@/components/photo-grid-draggable";
import { CheckoutButton } from "@/components/checkout-button";
import { PaymentStatusPoller } from "@/components/payment-status-poller";
import { DashboardRedirect } from "@/components/dashboard-redirect";
import { ListingFunnelEvents } from "@/components/listing-funnel-events";
import { isPlanTier, listingErrorField } from "@/lib/analytics";
import { CONSENT_COOKIE } from "@/lib/analytics-config";
import { FIRST_TOUCH_COOKIE, parseFirstTouch } from "@/lib/funnel-events";
import { recordFunnelEvent } from "@/lib/funnel-events.server";
import { AgreementButton } from "@/components/agreement-button";
import { AgreementStatusPoller } from "@/components/agreement-status-poller";
import {
  STEP1_FORM_COOKIE,
  STEP1_FORM_MAX_AGE_S,
  decodeStep1Form,
  encodeStep1Form,
  legacyStep1FormCookiePath,
  step1FormCookiePath,
  step1SignInHref,
  suggestedTierParam,
} from "@/lib/listing-step1-form";
import { AppFormValidation } from "@/components/app-form-validation";
import { FocusedErrorBanner } from "@/components/focused-error-banner";
import { PASSWORD_MIN_LENGTH, passwordRejection } from "@/lib/auth/password-errors";
import { FootnoteText } from "@/components/footnote-text";
import { fetchBuyerComp } from "@/lib/buyer-comp.server";
import { LegalServicesDisclosure } from "@/components/legal-services-disclosure";
import { BuyerCompStep } from "@/components/buyer-comp-step";
import {
  BUYER_COMP_MAX_PCT,
  buyerCompMaxAmount,
  formatOffer,
  offerChoice,
  offerFromRow,
  offerToRow,
  parseOfferInput,
  suggestedOffer,
  type OfferInputError,
} from "@/lib/buyer-comp";
import {
  BUYER_COMP_TERMS_VERSION,
  buyerAgentComp,
  publicationTimeline,
  refundPolicy,
} from "@/config/legal-terms";
import { markPropertyIfOutsideProduction } from "@/lib/test-data.server";
import { duplicateDraftId } from "@/lib/listing-step1-dedupe.server";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { isoToUsDate, parseLeaseEnd } from "@/lib/lease-end";
import { parseFinancing, savedFinancing } from "@/lib/financing-terms";
import { FinancingSection } from "@/components/financing-section";
import { MIN_OWN_PHOTOS, minPhotos, ownPhotosRequired } from "@/lib/listing-photos";
import { hasPaidPhotography } from "@/lib/listing-photos.server";
import { isCheckoutSessionId } from "@/lib/checkout-guard";
import { CONSENTS, consentCheckbox, consentNotice } from "@/lib/legal/consents";
import { recordAcceptance, termsAcceptedIn } from "@/lib/legal/consents.server";
import { reconcileTierCheckout } from "@/lib/checkout-return.server";
import { LocalizedValidation } from "@/components/localized-validation";
import { PROPERTY_TYPES, allowedStep, isOccupancyStatus, type OccupancyStatus } from "@/lib/listing-completeness";
import { loadFirstIncompleteStep } from "@/lib/listing-completeness.server";

const TOTAL_STEPS = 8;

/** Paso 7: contraseña rechazada por Supabase (filtrada o débil) → clave de `aerror`. */
/** IP del cliente para los límites de envío del código (primer valor de x-forwarded-for). */
async function requestIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

function passwordErrorKey(error: unknown): "leaked" | "rejected" | null {
  const r = passwordRejection(error);
  return r === "leaked" ? "leaked" : r === "weak" ? "rejected" : null;
}

function clampStep(value: number): number {
  return Math.min(Math.max(value, 1), TOTAL_STEPS);
}

// Paso terminado (validado y guardado): fila en funnel_events después de responder, para
// no demorar el redirect. El navegador recibe ?done=N y envía listing_step_complete.
function stepCompleted(
  lang: string,
  step: number,
  propertyId: string,
  userId: string | null,
  metadata: Record<string, unknown> = {},
): void {
  after(() =>
    recordFunnelEvent({
      event: "listing_step_complete",
      propertyId,
      userId,
      step,
      metadata: { lang, ...metadata },
    }),
  );
}



interface Draft {
  id: string;
  owner_id: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  latitude: number | null;
  longitude: number | null;
  pricing_tier: PricingTierId | null;
  mls_status: string;
  property_type: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  lot_size: number | null;
  year_built: number | null;
  list_price: number;
  description: string | null;
  showing_instructions: string | null;
  price_comps: RentcastComp[] | null;
  price_estimate_low: number | null;
  price_estimate_high: number | null;
  price_comps_fetched_at: string | null;
  parking_spaces: number | null;
  hoa_fee: number | null;
  tax_annual_amount: number | null;
  has_pool: boolean | null;
  cash_only: boolean | null;
  financing_terms: string[] | null;
  financing_other: string | null;
  as_is_sale: boolean | null;
  flood_zone: string | null;
  occupancy_status: OccupancyStatus | null;
  monthly_rent: number | null;
  lease_end_date: string | null;
  tenant_cooperation: string | null;
  tenant_notes: string | null;
  show_phone_on_portals: boolean | null;
  folio: string | null;
  buyer_agent_commission: number | null;
  buyer_agent_comp_type: string | null;
  buyer_agent_comp_amount: number | null;
  appliances: string[] | null;
}

export default async function ListingNewPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{
    step?: string;
    id?: string;
    error?: string;
    improved?: string;
    autofill?: string;
    uploaded?: string;
    /** Paso 5: la casilla de derechos estaba marcada en el envío que falló. */
    rights?: string;
    /** Paso 5: intento de envío (vuelve a montar el aviso de error). */
    n?: string;
    deleted?: string;
    primary?: string;
    success?: string;
    suggested_tier?: string;
    session_id?: string;
    signed?: string;
    event?: string;
    aerror?: string;
    pending?: string;
    resent?: string;
    cerror?: string;
    verified?: string;
    gerror?: string;
    gresent?: string;
    change?: string;
    resumed?: string;
    restore?: string;
  }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const locale: Locale = lang;

  // Deferred registration: the listing flow runs on an anonymous Supabase
  // session (created lazily in saveStep1). We do NOT force sign-in here — the
  // seller builds their listing freely and only registers at the signing gate
  // (step 7). Read the user without redirecting.
  const {
    data: { user: sessionUser },
  } = await (await createClient()).auth.getUser();
  // A real (email-bearing) account is required to sign. Anonymous users — and
  // users mid email-confirmation (email pending in new_email) — are gated at
  // step 7. A confirmed email is the signal that registration is complete.
  // Sellers who confirmed their email at step 1 still owe a name and a
  // password at step 7 (`account_pending`), but no second email code.
  const accountPending = sessionUser?.user_metadata?.account_pending === true;
  const needsAccount = !sessionUser?.email || accountPending;
  const pendingEmail = (sessionUser?.new_email as string | undefined) ?? null;

  const sp = await searchParams;
  const step = clampStep(Number.parseInt(sp.step ?? "1", 10) || 1);
  // Paso 1 que volvió con error, o tras iniciar sesión desde ese error (`restore=1`): lo que
  // el vendedor había escrito (ver backToStep1).
  const step1Saved =
    step === 1 && (sp.error || sp.restore === "1")
      ? decodeStep1Form((await cookies()).get(STEP1_FORM_COOKIE)?.value)
      : null;
  const savedCoord = (v: string | undefined): number | null => {
    const n = v ? Number.parseFloat(v) : Number.NaN;
    return Number.isFinite(n) ? n : null;
  };
  const draftId = sp.id ?? null;
  const copy = t(lang).listingForm;

  // Step-1 email gate (Phase B). Off until EMAIL_CODE_PEPPER is set, so the
  // flow keeps working exactly as before in any environment without it.
  const emailGateOn = Boolean(process.env.EMAIL_CODE_PEPPER);
  const needsGateEmail = emailGateOn && !sessionUser?.email;
  // The gate is the first thing after the address: no step 2+ without a
  // confirmed email, so we can always reach the seller with a magic link.
  if (needsGateEmail && sessionUser && draftId && step >= 2) {
    redirect(`/${lang}/listing/new?step=1&id=${draftId}`);
  }
  const gateCodeEmail =
    needsGateEmail && sessionUser && draftId && step === 1 && sp.change !== "1"
      ? await pendingChallengeEmail(sessionUser.id)
      : null;
  if (emailGateOn && sessionUser?.email && draftId && step >= 2) {
    await recordLeadStep(sessionUser.id, draftId, step);
  }

  let draft: Draft | null = null;
  let step3County: string | null = null;
  let step3MiamiDade: boolean | null = null;
  let photos: Array<{
    id: string;
    url: string;
    is_primary: boolean;
    display_order: number;
    is_staged?: boolean;
    original_photo_id?: string | null;
  }> = [];
  type PaymentRow = {
    status: "pending" | "succeeded" | "failed" | "refunded";
    amount: number;
    tier: string | null;
    stripe_checkout_session_id: string | null;
  };
  type AgreementRow = {
    status: "pending" | "sent" | "delivered" | "signed" | "completed" | "declined" | "voided" | "expired";
  };
  let latestPayment: PaymentRow | null = null;
  let latestAgreement: AgreementRow | null = null;
  if (draftId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("properties")
      .select(
        "id,owner_id,address_street,address_city,address_state,address_zip,latitude,longitude,pricing_tier,mls_status,property_type,bedrooms,bathrooms,sqft,lot_size,year_built,list_price,description,showing_instructions,price_comps,price_estimate_low,price_estimate_high,price_comps_fetched_at,parking_spaces,hoa_fee,tax_annual_amount,has_pool,cash_only,financing_terms,financing_other,as_is_sale,flood_zone,occupancy_status,monthly_rent,lease_end_date,tenant_cooperation,tenant_notes,show_phone_on_portals,folio,appliances",
      )
      .eq("id", draftId)
      .maybeSingle();
    draft = (data as Draft | null) ?? null;
    // La oferta del paso 6 no viene en el select (la tabla no expone esas columnas a la API).
    // Si la lectura falla, el paso 6 se muestra sin elección, como un borrador nuevo.
    if (draft) {
      const offer = await fetchBuyerComp(supabase, draft.id).catch((err) => {
        console.error("listing/new: buyer comp read failed", err);
        return null;
      });
      draft = { ...draft, ...offer };
    }

    // Admins and brokers can READ every draft (RLS), so a staff session could
    // walk a seller's listing all the way to step 7 and only then fail with
    // property_not_found_or_not_yours. Stop here and say why instead.
    if (draft && sessionUser && draft.owner_id !== sessionUser.id) {
      const [{ data: isAdmin }, { data: isBroker }] = await Promise.all([
        supabase.rpc("has_role", { _role: "admin" }),
        supabase.rpc("has_role", { _role: "broker" }),
      ]);
      const isStaff = isAdmin === true || isBroker === true;
      const notice = copy.foreignDraft;
      return (
        <StepShell
          stepNumber={step}
          totalSteps={TOTAL_STEPS}
          stepNames={copy.stepNames}
          eyebrow={copy.eyebrow}
          titleBefore={copy.titleBefore}
          titleAccent={copy.titleAccent}
          titleAfter={copy.titleAfter}
          stepLabel={copy.stepLabel}
          ofLabel={copy.ofLabel}
        >
          <div className="flex flex-col gap-5 border border-gold bg-gold/5 p-6 lg:p-8">
            <h2 className="font-display text-2xl text-ink font-normal">{notice.title}</h2>
            <p className="text-base leading-relaxed text-ink/75">
              {notice.body} <span className="font-semibold text-ink">{sessionUser.email}</span>.{" "}
              {notice.howTo}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              {isStaff && (
                <Link
                  href={`/${lang}/admin/listings/${draft.id}/review`}
                  className="inline-flex items-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
                >
                  {notice.adminReview} →
                </Link>
              )}
              <form action={`/${lang}/auth/sign-out`} method="post">
                <button
                  type="submit"
                  className="text-[10px] uppercase tracking-[0.22em] text-gold hover:text-ink transition-colors"
                >
                  {notice.signOut}
                </button>
              </form>
            </div>
          </div>
        </StepShell>
      );
    }

    // Llegó por un enlace para retomar (correo pedido por el vendedor o enviado por la
    // broker, o el botón del panel). El navegador lo reporta con listing_resumed y quita el
    // marcador de la URL.
    const resumedSource = sp.resumed;
    if (
      draft &&
      sessionUser &&
      draft.owner_id === sessionUser.id &&
      (resumedSource === "email_link" || resumedSource === "broker_link" || resumedSource === "account")
    ) {
      const resumedId = draft.id;
      after(() =>
        recordFunnelEvent({
          event: "listing_resumed",
          propertyId: resumedId,
          userId: sessionUser.id,
          step,
          metadata: { lang, source: resumedSource },
        }),
      );
    }

    // Ya enviado (pagado, activo, bajo contrato…): sus campos clave no se editan aquí —
    // el guard de la base los rechaza — sino por solicitud a la broker (#136). Fotos
    // (paso 5) y cuenta / pago / acuerdo (7–8) siguen disponibles.
    if (draft && draft.mls_status !== "draft" && [1, 2, 3, 4, 6].includes(step)) {
      redirect(`/${lang}/dashboard/listings/${draftId}/requests`);
    }

    // Sin saltar pasos por URL: ?step=7 con los pasos 2–6 vacíos lleva al primero incompleto.
    // Si la lectura falla se muestra el paso pedido; el acuerdo vuelve a comprobarlo.
    if (draft && sessionUser && draft.owner_id === sessionUser.id && draft.mls_status === "draft" && step > 1) {
      const firstIncomplete = await loadFirstIncompleteStep(supabase, draft.id).catch((err) => {
        console.error("listing/new: completeness check failed", err);
        return null;
      });
      const target = allowedStep(step, firstIncomplete);
      if (target !== step) redirect(`/${lang}/listing/new?step=${target}&id=${draft.id}`);
    }

    // Step 3 auto-fetch: Miami-Dade autofill (if zip is Miami-Dade + fields
    // still placeholders) + Rentcast comps (if not fetched yet). Runs server-
    // side on entry to Step 3 so the form pre-populates with real data + the
    // comps panel renders immediately.
    // Step 3: county from Google geocoding (administrative_area_level_2), not the ZIP —
    // 33xxx also covers Broward (333xx) and Palm Beach (334xx). null = unknown (no key,
    // error, quota): no county lookup is offered and no "outside Miami-Dade" notice shown.
    if (step === 3 && draft) {
      step3County = await countyForAddress(
        baseStreetForLookup(draft.address_street),
        draft.address_city,
        draft.address_state,
        draft.address_zip,
      );
      step3MiamiDade = step3County === null ? null : isMiamiDadeCounty(step3County);
    }

    if (step === 3 && draft) {
      const tasks: Promise<unknown>[] = [];
      const updates: Record<string, unknown> = {};

      const isMiamiDade = step3MiamiDade === true;
      const fieldsEmpty =
        draft.bedrooms === 0 &&
        draft.sqft === 0 &&
        (draft.year_built == null || draft.year_built >= new Date().getFullYear());
      if (isMiamiDade && fieldsEmpty) {
        tasks.push(
          lookupMiamiDadeProperty(baseStreetForLookup(draft.address_street), draft.address_zip, unitFromStoredStreet(draft.address_street)).then(
            (result) => {
              if (result.folio) updates.folio = result.folio;
              if (result.found && result.details) {
                const d = result.details;
                if (d.bedrooms != null) updates.bedrooms = d.bedrooms;
                if (d.bathrooms != null) updates.bathrooms = d.bathrooms;
                if (d.sqft != null) updates.sqft = d.sqft;
                if (d.lot_size != null) updates.lot_size = d.lot_size;
                if (d.year_built != null) updates.year_built = d.year_built;
                if (d.property_type != null)
                  updates.property_type = d.property_type;
                if (d.legal_description != null)
                  updates.legal_description = d.legal_description;
                // Estimated annual tax — only when the seller hasn't entered one.
                if (
                  d.tax_annual_amount != null &&
                  draft?.tax_annual_amount == null
                )
                  updates.tax_annual_amount = d.tax_annual_amount;
              }
            },
          ),
        );
      }

      const compsEmpty = !draft.price_comps_fetched_at;
      if (compsEmpty) {
        tasks.push(
          fetchRentcastEstimate(
            baseStreetForLookup(draft.address_street),
            draft.address_city,
            draft.address_state,
            draft.address_zip,
          ).then((rc) => {
            if (rc.status === "ok") {
              updates.price_comps = rc.estimate.comps;
              updates.price_estimate_low = rc.estimate.priceLow;
              updates.price_estimate_high = rc.estimate.priceHigh;
              updates.price_comps_fetched_at = new Date().toISOString();
            } else if (rc.status === "no_data") {
              // Mark as fetched to avoid retrying on every page load. Empty
              // comps means "no data for this area" — user fills price manually.
              updates.price_comps = [];
              updates.price_comps_fetched_at = new Date().toISOString();
            }
            // "error": nothing is stored, so the next visit retries.
          }),
        );
      }

      if (tasks.length > 0) {
        await Promise.allSettled(tasks);
        if (Object.keys(updates).length > 0) {
          await supabase
            .from("properties")
            .update(updates)
            .eq("id", draftId);
          // Re-merge into draft so the render uses fresh values.
          draft = { ...draft, ...updates } as Draft;
        }
      }
    }

    if (step === 5 || step === 6) {
      const { data: photoRows } = await supabase
        .from("property_photos")
        .select("id,url,is_primary,display_order,is_staged,original_photo_id")
        .eq("property_id", draftId)
        .order("display_order", { ascending: true });
      photos = (photoRows ?? []) as typeof photos;
    }


    if (step === 7 || step === 8) {
      const { data: agRow } = await supabase
        .from("agreements")
        .select("status")
        .eq("property_id", draftId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (agRow) latestAgreement = agRow as AgreementRow;
    }

    if (step === 8) {
      const loadPayment = async (): Promise<PaymentRow | null> => {
        const { data: payRow } = await supabase
          .from("payments")
          .select("status, amount, tier, stripe_checkout_session_id")
          .eq("property_id", draftId)
          .not("tier", "is", null) // la fotografía (paso 5) también es flat_fee, sin tier
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return (payRow as PaymentRow | null) ?? null;
      };
      latestPayment = await loadPayment();

      // Sin depender solo del webhook: al volver de Stripe (?session_id=) o con un pago
      // pendiente, se lee la sesión en Stripe y, si está pagada, se cumple aquí mismo
      // (mismo código e idempotencia que el webhook).
      if (draft && sessionUser && draft.owner_id === sessionUser.id && draft.mls_status === "draft") {
        const pendingPayment: PaymentRow | null = latestPayment;
        const candidates = new Set<string>();
        if (isCheckoutSessionId(sp.session_id)) candidates.add(sp.session_id);
        if (pendingPayment?.status === "pending" && isCheckoutSessionId(pendingPayment.stripe_checkout_session_id)) {
          candidates.add(pendingPayment.stripe_checkout_session_id);
        }
        for (const sessionId of candidates) {
          const result = await reconcileTierCheckout({ sessionId, propertyId: draftId, userId: sessionUser.id });
          if (result === "fulfilled" || result === "already") {
            latestPayment = await loadPayment();
            const { data: fresh } = await supabase
              .from("properties")
              .select("mls_status")
              .eq("id", draftId)
              .maybeSingle();
            if (fresh?.mls_status) draft = { ...draft, mls_status: fresh.mls_status } as Draft;
            break;
          }
        }
      }
    }
  }

  async function saveStep1(formData: FormData) {
    "use server";
    const rawStreet = String(formData.get("street") ?? "").trim();
    const unit = String(formData.get("unit") ?? "").trim();
    const city = String(formData.get("city") ?? "").trim();
    const state = String(formData.get("state") ?? "FL").trim().toUpperCase();
    const zip = String(formData.get("zip") ?? "").trim();
    const latRaw = String(formData.get("lat") ?? "").trim();
    const lngRaw = String(formData.get("lng") ?? "").trim();
    const latitude = latRaw ? Number.parseFloat(latRaw) : null;
    const longitude = lngRaw ? Number.parseFloat(lngRaw) : null;
    const id = String(formData.get("id") ?? "");

    // Base street without any unit/apt token (for clean geocoding + county
    // lookup). The STORED street re-appends the unit so contracts and forms
    // carry the complete address.
    const baseStreet = rawStreet
      .replace(/[,\s]*\b(?:unit|apt|apartment|suite|ste|#)\b.*$/i, "")
      .trim();
    const street = unit ? `${baseStreet}, Unit ${unit}` : rawStreet;

    // Error en el paso 1: volver con lo escrito (dirección y correo en una cookie httpOnly
    // corta, nunca en la URL) y con el plan sugerido en la URL, como llegó.
    const backToStep1 = async (error: string): Promise<never> => {
      (await cookies()).set(
        STEP1_FORM_COOKIE,
        encodeStep1Form({
          street: rawStreet,
          unit,
          city,
          zip,
          lat: latRaw,
          lng: lngRaw,
          email: String(formData.get("email") ?? ""),
        }),
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: step1FormCookiePath(lang),
          maxAge: STEP1_FORM_MAX_AGE_S,
        },
      );
      const tierParam = suggestedTierParam(formData.get("suggested_tier"), ["essentials", "pro", "concierge"]);
      redirect(`/${lang}/listing/new?step=1${id ? `&id=${id}` : ""}${tierParam}&error=${error}`);
    };

    if (!baseStreet || !city || !zip) {
      await backToStep1("required");
    }
    if (state !== "FL") {
      await backToStep1("fl_only");
    }

    // Email gate: only asked while the session has no confirmed email.
    const gateOn = Boolean(process.env.EMAIL_CODE_PEPPER);
    const {
      data: { user: currentUser },
    } = await (await createClient()).auth.getUser();
    const askEmail = gateOn && !currentUser?.email;
    const gateEmail = normalizeEmail(formData.get("email"));
    if (askEmail) {
      if (!isValidEmail(gateEmail)) {
        await backToStep1("email");
      }
      if (await emailTakenByAnotherUser(gateEmail, currentUser?.id ?? null)) {
        await backToStep1("email_exists");
      }
    }
    // After saving the address (step 1 complete): send the code, or go straight to step 2.
    // UTM de primer contacto solo si la persona aceptó cookies (sin consentimiento no hay
    // cookie lx_ft, y se comprueba igual).
    const continueTo = async (propertyId: string, uid: string): Promise<never> => {
      const jar = await cookies();
      jar.delete({ name: STEP1_FORM_COOKIE, path: step1FormCookiePath(lang) });
      jar.delete({ name: STEP1_FORM_COOKIE, path: legacyStep1FormCookiePath(lang) });
      const firstTouch =
        jar.get(CONSENT_COOKIE)?.value === "granted"
          ? parseFirstTouch(jar.get(FIRST_TOUCH_COOKIE)?.value)
          : {};
      stepCompleted(lang, 1, propertyId, uid, firstTouch);
      if (!askEmail) redirect(`/${lang}/listing/new?id=${propertyId}&step=2&done=1`);
      const sent = await startEmailChallenge({ userId: uid, email: gateEmail, lang: locale, ip: await requestIp() });
      const err = sent === "sent" ? "" : sent === "limit" ? "&gerror=limit" : "&gerror=send";
      redirect(`/${lang}/listing/new?step=1&id=${propertyId}&done=1${err}`);
    };

    // Geocoding is BEST-EFFORT only — it drops a map pin, it NEVER gates the
    // seller's progress. Google Maps can be unavailable (referrer-restricted
    // key, quota, network) and a real seller must always be able to type their
    // address and continue. Prefer client coords (seller picked a Places
    // suggestion); otherwise a server geocode of the base street; otherwise
    // null (the listing simply has no precise pin yet — fixable later).
    const check = await validateUsAddress(baseStreet, city, state, zip);
    const finalLat =
      latitude !== null && Number.isFinite(latitude)
        ? latitude
        : (check.lat ?? null);
    const finalLng =
      longitude !== null && Number.isFinite(longitude)
        ? longitude
        : (check.lng ?? null);

    const supabase = await createClient();
    let {
      data: { user },
    } = await supabase.auth.getUser();
    // Deferred registration: if the seller has no session yet, start an
    // anonymous one so they can build the listing without signing up. They
    // upgrade to a real account at the signing gate (step 7). If anonymous
    // sign-ins are unavailable, fall back to the sign-in redirect.
    if (!user) {
      // Anonymous sign-up is captcha-protected (Cloudflare Turnstile, verified
      // by Supabase Auth). The widget sits in the step-1 form.
      const { data: anon, error: anonError } =
        await supabase.auth.signInAnonymously({
          options: { captchaToken: captchaTokenFrom(formData) },
        });
      if (isCaptchaError(anonError)) {
        await backToStep1("captcha");
      }
      user = anon.user ?? null;
    }
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    const addressUpdate = {
      address_street: street,
      address_city: city,
      address_state: state,
      address_zip: zip,
      latitude: finalLat,
      longitude: finalLng,
    };

    // Sin id: si este dueño acaba de crear un borrador con la MISMA dirección (doble envío),
    // se actualiza ese. Otra dirección crea un listing nuevo.
    const existingId = id || (await duplicateDraftId(supabase, user.id, { street, zip }));
    if (existingId) {
      const { error } = await supabase
        .from("properties")
        .update(addressUpdate)
        .eq("id", existingId)
        .eq("owner_id", user.id);
      if (error) {
        await backToStep1("save_failed");
      }
      await continueTo(existingId, user.id);
    }

    const suggestedTierRaw = String(formData.get("suggested_tier") ?? "");
    const suggestedTier = (
      ["essentials", "pro", "concierge"] as const
    ).includes(suggestedTierRaw as PricingTierId)
      ? (suggestedTierRaw as PricingTierId)
      : null;

    const { data: created, error } = await supabase
      .from("properties")
      .insert({
        owner_id: user.id,
        ...addressUpdate,
        // Hasta que el condado diga otra cosa (paso 3): con unidad, Condo.
        property_type: unitFromStoredStreet(street) ? "condo" : "single_family",
        bedrooms: 0,
        bathrooms: 1,
        sqft: 0,
        // Sin año hasta que lo dé el condado o el vendedor. Antes se guardaba el año actual,
        // que se mostraba como si fuera el dato real (p. ej. 2026 en 100 Biscayne Blvd).
        year_built: null,
        list_price: 0,
        mls_status: "draft",
        ...(suggestedTier ? { pricing_tier: suggestedTier } : {}),
      })
      .select("id")
      .single();
    if (error || !created) {
      await backToStep1("save_failed");
    }
    // Fuera de Production, la propiedad es una prueba (la marca el servidor: el guard no
    // deja que el vendedor la inserte con is_test).
    await markPropertyIfOutsideProduction(created!.id);
    await continueTo(created!.id, user.id);
  }

  // Step 1 email code: confirm, or resend.
  async function verifyGateCode(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);
    const back = `/${lang}/listing/new?step=1&id=${id}`;
    const code = cleanCodeInput(formData.get("code"));
    if (!isCodeFormat(code)) redirect(`${back}&gerror=format`);

    const {
      data: { user },
    } = await (await createClient()).auth.getUser();
    if (!user) redirect(`/${lang}/listing/continue`);

    const result = await verifyEmailChallenge({
      userId: user.id,
      code,
      lang: locale,
      propertyId: id,
    });
    if (result !== "verified") redirect(`${back}&gerror=${result}`);
    redirect(`/${lang}/listing/new?id=${id}&step=2&ev=email_verified_gate`);
  }

  async function resendGateCode(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);
    const back = `/${lang}/listing/new?step=1&id=${id}`;
    const {
      data: { user },
    } = await (await createClient()).auth.getUser();
    if (!user) redirect(`/${lang}/listing/continue`);
    const email = await pendingChallengeEmail(user.id);
    if (!email) redirect(`${back}&change=1`);
    const sent = await startEmailChallenge({ userId: user.id, email, lang: locale, ip: await requestIp() });
    if (sent === "limit") redirect(`${back}&gerror=limit`);
    if (sent !== "sent") redirect(`${back}&gerror=send`);
    redirect(`${back}&gresent=1`);
  }

  async function saveStep2(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const tier = String(formData.get("pricing_tier") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);
    if (!["essentials", "pro", "concierge"].includes(tier)) {
      redirect(`/${lang}/listing/new?step=2&id=${id}&error=required`);
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    const { error } = await supabase
      .from("properties")
      .update({ pricing_tier: tier })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) {
      redirect(`/${lang}/listing/new?step=2&id=${id}&error=save_failed`);
    }
    stepCompleted(lang, 2, id, user.id, { plan_tier: tier });
    redirect(`/${lang}/listing/new?id=${id}&step=3&done=2`);
  }

  async function saveStep3(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);

    const propertyType = String(formData.get("property_type") ?? "single_family");
    const bedrooms = Number.parseInt(String(formData.get("bedrooms") ?? "0"), 10);
    const bathrooms = Number.parseFloat(
      String(formData.get("bathrooms") ?? "1"),
    );
    const sqft = Number.parseInt(String(formData.get("sqft") ?? "0"), 10);
    const lotSizeRaw = String(formData.get("lot_size") ?? "").trim();
    const lotSizeParsed = lotSizeRaw === "" ? null : Number.parseInt(lotSizeRaw, 10);
    const lotSize = lotSizeParsed !== null && Number.isFinite(lotSizeParsed) ? lotSizeParsed : null;
    const yearBuilt = Number.parseInt(
      String(formData.get("year_built") ?? "0"),
      10,
    );
    const listPrice = Number.parseInt(
      String(formData.get("list_price") ?? "0"),
      10,
    );

    const parkingRaw = String(formData.get("parking_spaces") ?? "").trim();
    const parkingSpaces =
      parkingRaw === "" ? null : Number.parseInt(parkingRaw, 10);
    const hoaRaw = String(formData.get("hoa_fee") ?? "").trim();
    const hoaFee = hoaRaw === "" ? null : Number.parseInt(hoaRaw, 10);
    const taxRaw = String(formData.get("tax_annual_amount") ?? "").trim();
    const taxAnnual = taxRaw === "" ? null : Number.parseInt(taxRaw, 10);
    const hasPool = formData.get("has_pool") === "1";
    // Financiamiento aceptado (L23 del acuerdo): al menos una opción; Other con texto.
    const financing = parseFinancing(formData.getAll("financing_terms"), formData.get("financing_other"));
    if (!financing.ok) redirect(`/${lang}/listing/new?step=3&id=${id}&error=${financing.error}`);
    const asIsSale = formData.get("as_is_sale") === "1";
    const floodZoneRaw = String(formData.get("flood_zone") ?? "")
      .trim()
      .toUpperCase();
    const floodZone = floodZoneRaw === "" ? null : floodZoneRaw.slice(0, 10);
    // Ocupación (L20 del acuerdo): obligatoria; sin elegir, el contrato saldría con L20 en blanco.
    const occupancyRaw = String(formData.get("occupancy_status") ?? "");
    if (!isOccupancyStatus(occupancyRaw)) redirect(`/${lang}/listing/new?step=3&id=${id}&error=occupancy_required`);
    const occupancyStatus: OccupancyStatus = occupancyRaw;
    const showPhone = formData.get("show_phone_on_portals") === "1";
    // Appliances included with the sale (multi-select; validated against the
    // canonical list so only known keys are stored).
    const appliances = sanitizeAppliances(
      formData.getAll("appliances").map(String),
    );

    // Lease details — only persisted when a tenant occupies the property;
    // cleared to null otherwise so changing occupancy doesn't leave stale data.
    const isTenant = occupancyStatus === "tenant_occupied";
    const rentRaw = String(formData.get("monthly_rent") ?? "").trim();
    const monthlyRent =
      isTenant && rentRaw !== "" && Number.isFinite(Number(rentRaw))
        ? Number(rentRaw)
        : null;
    // Con inquilino: MM/DD/YYYY futura o «No la sé» (null). Va al acuerdo de listado (L20).
    const lease = isTenant
      ? parseLeaseEnd(String(formData.get("lease_end_date") ?? ""), formData.get("lease_end_unknown") === "1")
      : ({ ok: true, iso: null } as const);
    if (!lease.ok) redirect(`/${lang}/listing/new?step=3&id=${id}&error=${lease.error}`);
    const leaseEndDate = lease.iso;
    const coopRaw = String(formData.get("tenant_cooperation") ?? "");
    const tenantCooperation =
      isTenant &&
      (["cooperative", "advance_notice", "difficult"] as const).includes(
        coopRaw as "cooperative" | "advance_notice" | "difficult",
      )
        ? coopRaw
        : null;
    const notesRaw = String(formData.get("tenant_notes") ?? "").trim();
    const tenantNotes =
      isTenant && tenantCooperation === "difficult" && notesRaw !== ""
        ? notesRaw.slice(0, 1000)
        : null;

    if (
      !PROPERTY_TYPES.includes(propertyType as (typeof PROPERTY_TYPES)[number])
    ) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=invalid_type`);
    }
    // NaN (campo vacío o no numérico) nunca pasa: el formulario es noValidate.
    if (!Number.isFinite(bedrooms) || bedrooms < 0 || bedrooms > 30) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=invalid_beds`);
    }
    if (!Number.isFinite(bathrooms) || bathrooms <= 0 || bathrooms > 30) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=invalid_baths`);
    }
    if (!Number.isFinite(sqft) || sqft <= 0 || sqft > 100000) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=invalid_sqft`);
    }
    if (!Number.isFinite(yearBuilt) || yearBuilt < 1800 || yearBuilt > new Date().getFullYear() + 2) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=invalid_year`);
    }
    if (!Number.isFinite(listPrice) || listPrice <= 0 || listPrice > 1000000000) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=invalid_price`);
    }
    if (
      parkingSpaces !== null &&
      (Number.isNaN(parkingSpaces) || parkingSpaces < 0 || parkingSpaces > 50)
    ) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=invalid_parking`);
    }
    if (
      hoaFee !== null &&
      (Number.isNaN(hoaFee) || hoaFee < 0 || hoaFee > 100000)
    ) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=invalid_hoa`);
    }
    if (
      taxAnnual !== null &&
      (Number.isNaN(taxAnnual) || taxAnnual < 0 || taxAnnual > 10000000)
    ) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=invalid_tax`);
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    const { error } = await supabase
      .from("properties")
      .update({
        property_type: propertyType,
        bedrooms,
        bathrooms,
        sqft,
        lot_size: lotSize,
        year_built: yearBuilt,
        list_price: listPrice,
        parking_spaces: parkingSpaces,
        hoa_fee: hoaFee,
        tax_annual_amount: taxAnnual,
        has_pool: hasPool,
        cash_only: financing.cashOnly,
        financing_terms: financing.terms,
        financing_other: financing.other,
        as_is_sale: asIsSale,
        flood_zone: floodZone,
        occupancy_status: occupancyStatus,
        monthly_rent: monthlyRent,
        lease_end_date: leaseEndDate,
        tenant_cooperation: tenantCooperation,
        tenant_notes: tenantNotes,
        show_phone_on_portals: showPhone,
        appliances,
      })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=save_failed`);
    }
    stepCompleted(lang, 3, id, user.id);
    redirect(`/${lang}/listing/new?id=${id}&step=4&done=3`);
  }

  async function refreshComps(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);
    const { data: row } = await supabase
      .from("properties")
      .select("address_street,address_city,address_state,address_zip")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!row) return;
    // Force a fresh fetch (the default flow only fetches once, for determinism).
    const rc = await fetchRentcastEstimate(
      baseStreetForLookup(row.address_street),
      row.address_city,
      row.address_state,
      row.address_zip,
    );
    // A failed lookup keeps the comparables already stored instead of wiping them.
    if (rc.status === "error") {
      revalidatePath(`/${lang}/listing/new`);
      return;
    }
    const update =
      rc.status === "ok"
        ? {
            price_comps: rc.estimate.comps,
            price_estimate_low: rc.estimate.priceLow,
            price_estimate_high: rc.estimate.priceHigh,
            price_comps_fetched_at: new Date().toISOString(),
          }
        : { price_comps: [], price_comps_fetched_at: new Date().toISOString() };
    await supabase
      .from("properties")
      .update(update)
      .eq("id", id)
      .eq("owner_id", user.id);
    revalidatePath(`/${lang}/listing/new`);
  }

  async function useSuggestedPrice(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    const { data: row } = await supabase
      .from("properties")
      .select("price_estimate_low,price_estimate_high")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (!row?.price_estimate_low || !row.price_estimate_high) {
      redirect(`/${lang}/listing/new?id=${id}&step=3&error=no_estimate`);
    }

    const avg = Math.round((row.price_estimate_low + row.price_estimate_high) / 2);
    const { error } = await supabase
      .from("properties")
      .update({ list_price: avg })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) {
      redirect(`/${lang}/listing/new?id=${id}&step=3&error=save_failed`);
    }
    redirect(`/${lang}/listing/new?id=${id}&step=3&success=suggested_filled`);
  }

  async function autofillStep3(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    const { data: row } = await supabase
      .from("properties")
      .select("address_street,address_zip")
      .eq("id", id)
      .eq("owner_id", user.id)
      .single();
    if (!row) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=save_failed`);
    }

    const result = await lookupMiamiDadeProperty(baseStreetForLookup(row.address_street), row.address_zip, unitFromStoredStreet(row.address_street));
    if (!result.found || !result.details) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&autofill=notfound`);
    }
    const d = result.details;
    const update: Record<string, number | string | null> = {};
    if (result.folio) update.folio = result.folio;
    if (d.bedrooms != null) update.bedrooms = d.bedrooms;
    if (d.bathrooms != null) update.bathrooms = d.bathrooms;
    if (d.sqft != null) update.sqft = d.sqft;
    if (d.lot_size != null) update.lot_size = d.lot_size;
    if (d.year_built != null) update.year_built = d.year_built;
    if (d.property_type != null) update.property_type = d.property_type;
    if (d.legal_description != null)
      update.legal_description = d.legal_description;
    if (d.tax_annual_amount != null)
      update.tax_annual_amount = d.tax_annual_amount;

    const filledCount = Object.keys(update).length;
    if (filledCount === 0) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&autofill=notfound`);
    }

    const { error } = await supabase
      .from("properties")
      .update(update)
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=save_failed`);
    }
    redirect(`/${lang}/listing/new?step=3&id=${id}&autofill=${filledCount}`);
  }

  async function saveStep4(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);

    const description = String(formData.get("description") ?? "").trim();
    const showing = String(formData.get("showing_instructions") ?? "").trim();
    const action = String(formData.get("action") ?? "next");

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    if (action === "improve_description") {
      if (description.length < 10) {
        redirect(`/${lang}/listing/new?step=4&id=${id}&error=empty_improve`);
      }
      const { data: facts } = await supabase
        .from("properties")
        .select(
          "bedrooms,bathrooms,sqft,year_built,address_city,address_state,list_price,property_type,lot_size",
        )
        .eq("id", id)
        .eq("owner_id", user.id)
        .single();
      if (!facts) {
        redirect(`/${lang}/listing/new?step=4&id=${id}&error=save_failed`);
      }
      let improved: string;
      try {
        improved = await improveListingDescription({
          description,
          facts: {
            bedrooms: facts.bedrooms,
            bathrooms: facts.bathrooms,
            sqft: facts.sqft,
            yearBuilt: facts.year_built,
            city: facts.address_city,
            state: facts.address_state,
            listPrice: facts.list_price,
            propertyType: facts.property_type,
            lotSize: facts.lot_size,
          },
        });
      } catch (e) {
        console.error("improve description failed", e);
        redirect(`/${lang}/listing/new?step=4&id=${id}&error=improve_failed`);
      }
      const { error } = await supabase
        .from("properties")
        .update({
          description: improved,
          showing_instructions: showing || null,
        })
        .eq("id", id)
        .eq("owner_id", user.id);
      if (error) {
        redirect(`/${lang}/listing/new?step=4&id=${id}&error=save_failed`);
      }
      redirect(`/${lang}/listing/new?step=4&id=${id}&improved=description`);
    }

    if (action === "improve_showing") {
      if (showing.length < 5) {
        redirect(`/${lang}/listing/new?step=4&id=${id}&error=empty_improve`);
      }
      let improved: string;
      try {
        improved = await improveShowingInstructions(showing);
      } catch (e) {
        console.error("improve showing failed", e);
        redirect(`/${lang}/listing/new?step=4&id=${id}&error=improve_failed`);
      }
      const { error } = await supabase
        .from("properties")
        .update({
          description: description || null,
          showing_instructions: improved,
        })
        .eq("id", id)
        .eq("owner_id", user.id);
      if (error) {
        redirect(`/${lang}/listing/new?step=4&id=${id}&error=save_failed`);
      }
      redirect(`/${lang}/listing/new?step=4&id=${id}&improved=showing`);
    }

    // "next" — save and advance
    if (description.length < 10) {
      redirect(`/${lang}/listing/new?step=4&id=${id}&error=invalid`);
    }
    const { error } = await supabase
      .from("properties")
      .update({
        description,
        showing_instructions: showing || null,
      })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) {
      redirect(`/${lang}/listing/new?step=4&id=${id}&error=save_failed`);
    }
    stepCompleted(lang, 4, id, user.id);
    redirect(`/${lang}/listing/new?id=${id}&step=5&done=4`);
  }

  async function uploadPhotosAction(formData: FormData) {
    "use server";
    // Direct-to-Supabase uploads happen client-side (browser uploads bypass
    // Vercel's 4.5 MB platform body limit). This action only receives the
    // resulting public URLs and persists property_photos rows.
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);

    const urls = formData
      .getAll("urls")
      .map((u) => String(u))
      .filter((u) => u.length > 0);
    if (urls.length === 0) {
      redirect(`/${lang}/listing/new?step=5&id=${id}&error=no_files`);
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    // Ownership gate — even though Storage RLS already prevented foreign
    // uploads, double-check before inserting DB rows.
    const { data: own } = await supabase
      .from("properties")
      .select("id")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!own) redirect(`/${lang}/listing/new?step=5&id=${id}&error=save_failed`);

    const { data: existing } = await supabase
      .from("property_photos")
      .select("display_order")
      .eq("property_id", id)
      .order("display_order", { ascending: false })
      .limit(1);
    const nextOrder =
      existing && existing.length > 0 ? existing[0].display_order + 1 : 0;
    const hasAnyExisting = (existing?.length ?? 0) > 0;

    const rows = urls.map((url, i) => ({
      property_id: id,
      url,
      is_primary: !hasAnyExisting && nextOrder + i === 0,
      display_order: nextOrder + i,
    }));
    const { error: insErr } = await supabase
      .from("property_photos")
      .insert(rows);
    if (insErr) {
      redirect(`/${lang}/listing/new?step=5&id=${id}&error=upload_failed`);
    }
    redirect(`/${lang}/listing/new?step=5&id=${id}&uploaded=${urls.length}`);
  }

  async function deletePhotoAction(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const photoId = String(formData.get("photo_id") ?? "");
    const url = String(formData.get("url") ?? "");
    if (!id || !photoId) {
      redirect(`/${lang}/listing/new?step=5&id=${id}&error=required`);
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    // Verify ownership via the property
    const { data: prop } = await supabase
      .from("properties")
      .select("id")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!prop) redirect(`/${lang}/listing/new?step=5&id=${id}&error=save_failed`);

    const storagePath = storagePathFromUrl(url);
    if (storagePath) {
      await deletePropertyPhoto(storagePath);
    }
    await supabase.from("property_photos").delete().eq("id", photoId);
    redirect(`/${lang}/listing/new?step=5&id=${id}&deleted=1`);
  }

  async function reorderPhotosAction(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=5&id=${id}&error=required`);

    const orderedIds = formData.getAll("ids").map((x) => String(x));
    if (orderedIds.length === 0) return;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    const { data: prop } = await supabase
      .from("properties")
      .select("id")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!prop) return;

    // Sequential updates — Supabase doesn't support batch in this shape via
    // postgrest; volume is small (≤30 photos per listing).
    for (let i = 0; i < orderedIds.length; i++) {
      await supabase
        .from("property_photos")
        .update({ is_primary: i === 0, display_order: i })
        .eq("id", orderedIds[i])
        .eq("property_id", id);
    }
  }

  async function setPrimaryAction(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const photoId = String(formData.get("photo_id") ?? "");
    if (!id || !photoId) {
      redirect(`/${lang}/listing/new?step=5&id=${id}&error=required`);
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    const { data: prop } = await supabase
      .from("properties")
      .select("id")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!prop) redirect(`/${lang}/listing/new?step=5&id=${id}&error=save_failed`);

    await supabase
      .from("property_photos")
      .update({ is_primary: false })
      .eq("property_id", id);
    await supabase
      .from("property_photos")
      .update({ is_primary: true })
      .eq("id", photoId);

    redirect(`/${lang}/listing/new?step=5&id=${id}&primary=1`);
  }

  async function nextFromStep5(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);

    const supabase = await createClient();
    const { data: prop } = await supabase
      .from("properties")
      .select("pricing_tier")
      .eq("id", id)
      .maybeSingle();
    const requiredPhotos = minPhotos(
      prop?.pricing_tier as string | null,
      await hasPaidPhotography(supabase, id),
    );

    const { count } = await supabase
      .from("property_photos")
      .select("id", { count: "exact", head: true })
      .eq("property_id", id);
    const photoCount = count ?? 0;

    // Every plan: at least minPhotos (MIN_OWN_PHOTOS on Essentials without photography; the
    // front photo with professional photography, which the MLS needs within 2 business days,
    // SEFMLS §15.1.1/§15.1.12), and the rights box.
    // `n`: un intento por redirección, para que el aviso vuelva a llevar el scroll y el foco
    // aunque el error se repita. `rights=1`: la casilla sigue marcada si lo que faltaba eran
    // las fotos (React reinicia el formulario después de la acción).
    const attempt = `&n=${new Date().getTime().toString(36)}`;
    if (formData.get("photos_rights_confirmed") !== "1") {
      redirect(`/${lang}/listing/new?step=5&id=${id}&error=rights_required${attempt}`);
    }
    if (photoCount < requiredPhotos) {
      redirect(`/${lang}/listing/new?step=5&id=${id}&error=not_enough&rights=1${attempt}`);
    }

    // Persist confirmation once migration 20260517_add_listing_extended_fields
    // is applied (column added there). Until then this is a no-op update.
    await supabase
      .from("properties")
      .update({ photos_rights_confirmed: true })
      .eq("id", id);

    if (prop) stepCompleted(lang, 5, id, null, { photos_count: photoCount });
    redirect(`/${lang}/listing/new?step=6&id=${id}&done=5`);
  }

  // Paso 6: la oferta al agente del comprador se guarda al continuar. 0% es válido; sin
  // elección (Essentials y Pro no traen preselección) se pide elegir. La versión del texto
  // queda con la oferta y el trigger de la migración 20261017150000 la registra con fecha.
  async function nextFromStep6(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    const { data: prop } = await supabase
      .from("properties")
      .select("list_price")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!prop) redirect(`/${lang}/listing/new?step=1&error=required`);

    const parsed = parseOfferInput(
      {
        choice: formData.get("buyer_comp_choice") as string | null,
        customKind: formData.get("buyer_comp_custom_kind") as string | null,
        customValue: formData.get("buyer_comp_custom_value") as string | null,
      },
      prop.list_price,
    );
    if (!parsed.ok) {
      redirect(`/${lang}/listing/new?step=6&id=${id}&error=buyer_comp_${parsed.error}`);
    }

    const row = offerToRow(parsed.offer);
    const { error } = await supabase
      .from("properties")
      .update({
        buyer_agent_comp_type: row.buyer_agent_comp_type,
        buyer_agent_commission: row.buyer_agent_commission,
        buyer_agent_comp_amount: row.buyer_agent_comp_amount,
        buyer_agent_comp_terms_version: BUYER_COMP_TERMS_VERSION,
      })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) redirect(`/${lang}/listing/new?step=6&id=${id}&error=save_failed`);

    stepCompleted(lang, 6, id, null);
    redirect(`/${lang}/listing/new?step=7&id=${id}&done=6`);
  }

  // Signing gate: convert the anonymous seller into a permanent account. The
  // email goes to new_email (pending) until they confirm via the link; the same
  // uid is kept, so the whole draft stays attached. We also write the real
  // name/email into public.users now (service role) so the agreement carries the
  // correct signer even while the auth email is still confirming.
  async function registerAccount(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const firstName = String(formData.get("first_name") ?? "").trim().slice(0, 80);
    const lastName = String(formData.get("last_name") ?? "").trim().slice(0, 80);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);
    const back = `/${lang}/listing/new?step=7&id=${id}`;
    // Aceptación expresa de los Términos y la Privacidad: sin la casilla no se crea la cuenta.
    if (!termsAcceptedIn(formData)) redirect(`${back}&aerror=terms_required`);
    if (!firstName || !lastName) redirect(`${back}&aerror=name`);
    if (password.length < PASSWORD_MIN_LENGTH) redirect(`${back}&aerror=password`);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    // La prueba se guarda ANTES de convertir la sesión en una cuenta: si no queda registrada,
    // no se crea la cuenta (falla cerrado).
    const termsRecorded = await recordAcceptance({
      document: "terms",
      lang: lang === "es" ? "es" : "en",
      context: "step7_account",
      userId: user.id,
      propertyId: id,
      headers: await headers(),
    });
    if (!termsRecorded) redirect(`${back}&aerror=failed`);

    // Email already confirmed with the step-1 code: no second code, just set
    // the name and password on the same account.
    //
    // Through the seller's OWN session, never admin.updateUserById: a password
    // set by the admin API logs the user out of every session (Supabase Auth
    // `UpdatePassword(tx, nil)` → `Logout`), so the very next step-7 action found
    // no user and bounced the seller to /sign-in with their draft orphaned
    // (production test 2026-10-15 02:43Z). updateUser keeps the current session.
    if (user.email && user.user_metadata?.account_pending === true) {
      const { error: pwError } = await supabase.auth.updateUser({
        password,
        data: {
          first_name: firstName,
          last_name: lastName,
          account_pending: false,
        },
      });
      if (pwError) redirect(`${back}&aerror=${passwordErrorKey(pwError) ?? "failed"}`);
      const svc = createService();
      await svc
        .from("users")
        .upsert(
          { id: user.id, email: user.email, first_name: firstName, last_name: lastName },
          { onConflict: "id" },
        );
      redirect(back);
    }

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect(`${back}&aerror=email`);

    const { error } = await supabase.auth.updateUser(
      {
        email,
        password,
        data: { first_name: firstName, last_name: lastName },
      },
      {
        emailRedirectTo: `${SITE_URL}/${lang}/auth/callback?next=${encodeURIComponent(
          `/${lang}/listing/new?step=7&id=${id}`,
        )}`,
      },
    );
    if (error) {
      const code =
        passwordErrorKey(error) ??
        (/registered|already/i.test(error.message) ? "exists" : "failed");
      redirect(`${back}&aerror=${code}`);
    }

    // Capture the real signer profile immediately (service role bypasses RLS).
    const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const svcKey = process.env.SUPABASE_SECRET_KEY;
    if (svcUrl && svcKey) {
      const svc = createServiceClient(svcUrl, svcKey, {
        auth: { persistSession: false },
      });
      await svc
        .from("users")
        .upsert(
          { id: user.id, email, first_name: firstName, last_name: lastName },
          { onConflict: "id" },
        );
    }

    redirect(`${back}&pending=1`);
  }

  // Reenvío del código de confirmación. Existe porque el código expira y los
  // correos se pierden: sin esto, un vendedor que no lo recibe queda atrapado en
  // el paso 7 con su listing completo y sin salida.
  //
  // Manda correo, así que va con rate limit propio. Supabase también limita por
  // su lado; este límite es el que da un mensaje útil en vez de un fallo opaco.
  async function resendEmailCode(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);
    const back = `/${lang}/listing/new?step=7&id=${id}`;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    // Solo hay algo que reenviar si hay un cambio de correo pendiente.
    const pending = (user.new_email as string | undefined) ?? "";
    if (!pending) redirect(`${back}&aerror=failed`);

    // 3 reenvíos por hora y por usuario. Suficiente para un correo perdido o un
    // código expirado; no para usar la cuenta como relay de spam.
    const limiter = apiLimiter("listing:resend-code", 3, "1 h");
    if (limiter) {
      const { success } = await limiter.limit(user.id);
      if (!success) redirect(`${back}&pending=1&cerror=resend_limit`);
    }

    const emailRedirectTo = `${SITE_URL}/${lang}/auth/callback?next=${encodeURIComponent(
      `/${lang}/listing/new?step=7&id=${id}`,
    )}`;

    // `resend` es la vía específica; si Supabase clasifica distinto el upgrade de
    // un usuario anónimo, `updateUser` re-dispara el mismo correo. Mismo patrón de
    // respaldo que usa verifyEmailCode con los tipos de OTP.
    const { error: resendError } = await supabase.auth.resend({
      type: "email_change",
      email: pending,
      options: { emailRedirectTo, captchaToken: captchaTokenFrom(formData) },
    });

    // A failed bot check must not fall through to updateUser (which is not
    // captcha-protected) — that would resend anyway and bypass Turnstile.
    if (isCaptchaError(resendError)) {
      redirect(`${back}&pending=1&cerror=captcha`);
    }

    if (resendError) {
      const { error: updateError } = await supabase.auth.updateUser(
        { email: pending },
        { emailRedirectTo },
      );
      if (updateError) redirect(`${back}&pending=1&cerror=resend_failed`);
    }

    // El sello permite al cliente calcular el enfriamiento y que sobreviva a la
    // recarga que provoca este redirect.
    redirect(`${back}&pending=1&resent=${Math.floor(Date.now() / 1000)}`);
  }

  // #6: confirm the new email with a 6-digit code entered in the SAME tab
  // (instead of a link that opens a new window). Supabase's email-change
  // template sends the code; verifyOtp promotes the anonymous user to a
  // permanent account without leaving the flow.
  async function verifyEmailCode(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const token = String(formData.get("code") ?? "").replace(/\s+/g, "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);
    const back = `/${lang}/listing/new?step=7&id=${id}`;
    if (!/^\d{6}$/.test(token)) redirect(`${back}&pending=1&cerror=format`);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const pending = (user?.new_email as string | undefined) ?? user?.email ?? "";
    if (!user || !pending) redirect(`${back}&aerror=failed`);

    // Confirming a new email on an anonymous user lands the address in
    // `new_email`, i.e. an email-change confirmation — so "email_change" is the
    // expected OTP type. Try the other email OTP types as a fallback so the
    // flow is resilient to Supabase's exact classification of the upgrade.
    const otpTypes = ["email_change", "email", "signup"] as const;
    let verified = false;
    for (const type of otpTypes) {
      const { error } = await supabase.auth.verifyOtp({
        email: pending,
        token,
        type,
      });
      if (!error) {
        verified = true;
        break;
      }
    }
    if (!verified) redirect(`${back}&pending=1&cerror=invalid`);

    redirect(`${back}&verified=1&ev=email_verified_account`);
  }

  // Paso 7: aviso y casilla E-SIGN antes de abrir DocuSign (textos versionados, consents.ts).
  const esignProps = {
    notice: consentNotice("esign", lang),
    checkbox: consentCheckbox("esign", lang).before,
    version: CONSENTS.esign.version,
  };
  // Paso 5: misma regla que nextFromStep5 (src/lib/listing-photos.ts). El extra de
  // fotografía pagado cuenta como en Pro.
  const photographyPaid =
    draftId && (step === 5 || step === 6)
      ? await hasPaidPhotography(await createClient(), draftId)
      : false;
  // Essentials without photography uploads its own set; with professional photography, the
  // front photo only. Both block step 5 below the minimum.
  const photosRequired = ownPhotosRequired(draft?.pricing_tier ?? null, photographyPaid);
  const requiredPhotos = minPhotos(draft?.pricing_tier ?? null, photographyPaid);

  const errorMessage =
    sp.error === "captcha"
      ? t(lang).auth.errors.captchaFailed
      : sp.error === "email"
      ? copy.step1.emailInvalid
      : sp.error === "email_exists"
      ? copy.step1.emailExists
      : sp.error === "required"
      ? copy.stepErrors.required
      : sp.error === "fl_only"
        ? copy.step1.flOnly
        : sp.error === "address_invalid"
          ? copy.step1.addressInvalid
        : sp.error === "invalid"
          ? copy.stepErrors.invalid
          : sp.error === "invalid_type"
            ? copy.stepErrors.invalidType
            : sp.error === "invalid_beds"
              ? copy.stepErrors.invalidBeds
              : sp.error === "invalid_baths"
                ? copy.stepErrors.invalidBaths
                : sp.error === "invalid_sqft"
                  ? copy.stepErrors.invalidSqft
                  : sp.error === "invalid_year"
                    ? copy.stepErrors.invalidYear
                    : sp.error === "invalid_price"
                      ? copy.stepErrors.invalidPrice
                      : sp.error === "empty_improve"
                        ? copy.step4.emptyToImprove
                        : sp.error === "improve_failed"
                          ? copy.step4.improveFailed
                          : sp.error === "upload_failed"
                            ? copy.step5.uploadFailed
                            : sp.error === "not_enough"
                              ? (photosRequired
                                  ? copy.step5.notEnoughPhotos.replace("{min}", String(MIN_OWN_PHOTOS))
                                  : copy.step5.notEnoughFrontPhoto)
                              : sp.error === "no_files"
                                ? copy.step5.invalidFormat
                                : sp.error === "save_failed"
                                  ? copy.stepErrors.saveFailed
                                  : sp.error === "no_estimate"
                                    ? copy.stepErrors.noEstimate
                                    : sp.error === "rights_required"
                                      ? copy.step5.ownershipRequired
                                      : sp.error === "invalid_parking"
                                        ? copy.stepErrors.invalidParking
                                        : sp.error === "invalid_hoa"
                                          ? copy.stepErrors.invalidHoa
                                          : sp.error === "invalid_tax"
                                            ? copy.stepErrors.invalidTax
                                            : sp.error === "lease_end_required"
                                              ? copy.stepErrors.leaseEndRequired
                                              : sp.error === "lease_end_invalid"
                                                ? copy.stepErrors.leaseEndInvalid
                                                : sp.error === "lease_end_past"
                                                  ? copy.stepErrors.leaseEndPast
                                                  : sp.error === "occupancy_required"
                                                    ? copy.stepErrors.occupancyRequired
                                                    : sp.error === "financing_required"
                                                    ? copy.stepErrors.financingRequired
                                                    : sp.error === "financing_other_required"
                                                      ? copy.stepErrors.financingOtherRequired
                                                      : sp.error === "financing_other_too_long"
                                                        ? copy.stepErrors.financingOtherTooLong
                                                        : buyerCompError(sp.error);
  function buyerCompError(code: string | undefined): string | null {
    const c = copy.step6.buyerComp;
    const fill = (s: string) =>
      s.replace("{max}", String(BUYER_COMP_MAX_PCT)).replace("{maxAmount}", formatOffer({ type: "amount", amount: buyerCompMaxAmount(draft?.list_price) }));
    const map: Record<`buyer_comp_${OfferInputError | "over_limit"}`, string> = {
      buyer_comp_choice_required: c.choiceRequired,
      buyer_comp_pct_range: fill(c.pctRange),
      buyer_comp_pct_max: fill(c.pctMax),
      buyer_comp_amount_range: fill(c.amountRange),
      buyer_comp_amount_max: fill(c.amountMax),
      buyer_comp_over_limit: fill(c.overLimit),
    };
    return code && Object.hasOwn(map, code) ? map[code as keyof typeof map] : null;
  }
  const improvedFlag =
    typeof sp === "object" && "improved" in sp ? (sp.improved as string) : null;
  const autofillResult =
    typeof sp === "object" && "autofill" in sp ? (sp.autofill as string) : null;
  const autofillMessage =
    autofillResult === "notfound"
      ? copy.step3.autofillNotFound
      : autofillResult && /^\d+$/.test(autofillResult)
        ? copy.step3.autofillSuccess.replace("{count}", autofillResult)
        : null;
  const successFlag =
    typeof sp === "object" && "success" in sp ? (sp.success as string) : null;
  const suggestedFilledMessage =
    successFlag === "suggested_filled" ? copy.step3.suggestedFilled : null;

  return (
    <StepShell
      stepNumber={step}
      totalSteps={TOTAL_STEPS}
      stepNames={copy.stepNames}
      eyebrow={copy.eyebrow}
      titleBefore={copy.titleBefore}
      titleAccent={copy.titleAccent}
      titleAfter={copy.titleAfter}
      stepLabel={copy.stepLabel}
      ofLabel={copy.ofLabel}
      currentStepDone={step === 7 && !needsAccount && agreementSignedBySeller(latestAgreement?.status)}
    >
      <ListingFunnelEvents
        step={step}
        lang={lang}
        planTier={draft?.pricing_tier ?? null}
        photosCount={step === 6 ? photos.length : undefined}
        agreementSigned={agreementSignedBySeller(latestAgreement?.status)}
        errorField={listingErrorField(sp.error)}
        listingId={draft?.id ?? null}
        resumable={
          !!draft && !!sessionUser && draft.owner_id === sessionUser.id && draft.mls_status === "draft" && step >= 2
        }
      />
      {/* Browser validation bubbles in the page's language, not the browser's. */}
      <LocalizedValidation labels={copy.validation} />
      {/* ─── Step 1: Address ─── */}
      {step === 1 && (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-2xl text-ink font-normal">
              {copy.step1.title}
            </h2>
            <p className="text-base leading-relaxed text-ink/70">
              {copy.step1.body}
            </p>
          </div>
          {errorMessage && <ErrorBanner message={errorMessage} />}
          {sp.error === "email_exists" && (
            <Link
              data-step-notice
              href={step1SignInHref(lang, sp.suggested_tier)}
              className="self-start text-[10px] uppercase tracking-[0.22em] text-gold hover:text-ink transition-colors"
            >
              {copy.step1.emailSignIn} →
            </Link>
          )}
          {gateCodeEmail && draftId ? (
            <ListingEmailCode
              email={gateCodeEmail}
              draftId={draftId}
              verifyAction={verifyGateCode}
              resendAction={resendGateCode}
              changeEmailHref={`/${lang}/listing/new?step=1&id=${draftId}&change=1`}
              signInHref={step1SignInHref(lang, sp.suggested_tier)}
              error={typeof sp.gerror === "string" ? sp.gerror : null}
              resent={sp.gresent === "1"}
              labels={copy.step1.emailCode}
            />
          ) : (
          <form action={saveStep1} noValidate className="flex flex-col gap-6">
            <AppFormValidation step={1} lang={lang} message={copy.stepErrors.checkMarked}
              labels={copy.validation}
              fieldMessages={copy.fieldErrors}
            />
            {draftId && <input type="hidden" name="id" value={draftId} />}
            {sp.suggested_tier && (
              <input
                type="hidden"
                name="suggested_tier"
                value={sp.suggested_tier}
              />
            )}
            <AddressAutocomplete
              streetLabel={copy.step1.streetLabel}
              streetPlaceholder={copy.step1.streetPlaceholder}
              unitLabel={copy.step1.unitLabel}
              cityLabel={copy.step1.cityLabel}
              stateLabel={copy.step1.stateLabel}
              zipLabel={copy.step1.zipLabel}
              defaultStreet={step1Saved?.street || draft?.address_street || ""}
              defaultUnit={step1Saved?.unit ?? ""}
              defaultCity={step1Saved?.city || draft?.address_city || "Miami"}
              defaultZip={step1Saved?.zip || draft?.address_zip || ""}
              defaultLat={step1Saved ? savedCoord(step1Saved.lat) : (draft?.latitude ?? null)}
              defaultLng={step1Saved ? savedCoord(step1Saved.lng) : (draft?.longitude ?? null)}
              verifiedNote={copy.step1.verifiedNote}
              language={lang}
              mapsLoadingLabel={copy.step1.mapsLoading}
              mapsReadyLabel={copy.step1.mapsReady}
              mapsErrorLabel={copy.step1.mapsError}
            />
            {needsGateEmail && (
              <Field
                label={copy.step1.emailLabel}
                name="email"
                type="email"
                // Its own autofill section: with plain "email", picking the
                // browser suggestion also filled the street/city/ZIP with the
                // seller's saved home address, overwriting the property's.
                autoComplete="section-seller email"
                required
                defaultValue={step1Saved?.email || undefined}
                help={copy.step1.emailHelp}
              />
            )}
            {/* Only a visitor without a session triggers the anonymous
                sign-up in saveStep1; that's the only call needing a token. */}
            {!sessionUser && <TurnstileWidget lang={lang} />}
            <PendingSubmitButton>{copy.nextLabel} →</PendingSubmitButton>
            {!sessionUser && (
              <Link
                href={`/${lang}/listing/continue`}
                className="self-start text-sm text-ink/60 underline underline-offset-4 hover:text-gold transition-colors"
              >
                {copy.step1.continueExisting}
              </Link>
            )}
          </form>
          )}
        </div>
      )}

      {/* ─── Step 2: Plan tier ─── */}
      {step === 2 && (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-2xl text-ink font-normal">
              {copy.step2.title}
            </h2>
            <p className="text-base leading-relaxed text-ink/70">
              {copy.step2.body}
            </p>
          </div>
          {errorMessage && <ErrorBanner message={errorMessage} />}
          <form action={saveStep2} noValidate className="flex flex-col gap-6">
            <AppFormValidation step={2} lang={lang} message={copy.stepErrors.checkMarked}
              labels={copy.validation}
              fieldMessages={copy.fieldErrors}
            />
            <input type="hidden" name="id" value={draftId ?? ""} />
            <div className="flex flex-col gap-4">
              {TIER_ORDER.map((tierId) => {
                const tier = PRICING_TIERS[tierId];
                const tierCopy = t(lang).pricing.tiers[tierId];
                const pricingCopy = t(lang).pricing;
                const checked = draft?.pricing_tier === tierId;
                return (
                  <label
                    key={tierId}
                    className={`flex items-start gap-5 p-6 border cursor-pointer transition-colors ${
                      checked
                        ? "border-gold bg-ivory-strong"
                        : "border-gold-soft hover:border-gold/60"
                    }`}
                  >
                    <input
                      type="radio"
                      name="pricing_tier"
                      value={tierId}
                      defaultChecked={checked}
                      required
                      className="mt-1.5 accent-gold"
                    />
                    <div className="flex-1 flex flex-col gap-4">
                      <div className="flex items-baseline justify-between gap-4 flex-wrap">
                        <span className="font-display text-xl text-ink">
                          {tierCopy.name}
                        </span>
                        <span className="font-display italic text-2xl text-ink">
                          <span className="text-gold text-base align-top">$</span>
                          {tier.flatFee}{" "}
                          <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55 not-italic font-sans">
                            {copy.step2.flatFeeSuffix}
                          </span>
                        </span>
                      </div>
                      <span className="text-sm text-ink/70">
                        {tierCopy.tagline}
                      </span>
                      <span className="text-xs italic text-ink/65 leading-snug">
                        {tierCopy.forWhom}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                        + {tier.commissionPct}% {copy.step2.commissionLabel}
                      </span>
                      <div className="border-t border-gold-soft pt-4 flex flex-col gap-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                          {pricingCopy.includesLabel}
                        </div>
                        <ul className="flex flex-col gap-1.5 text-sm leading-snug">
                          {tierCopy.features.map((f) => (
                            <li key={f} className="flex items-start gap-2.5">
                              <span aria-hidden className="text-gold mt-0.5 leading-none">
                                •
                              </span>
                              <span className="text-ink/80">
                                <FootnoteText text={fillTierCopy(f, tierId)} lang={lang} />
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center gap-6">
              <Link
                href={`/${lang}/listing/new?step=1&id=${draftId}`}
                className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
              >
                ← {copy.backLabel}
              </Link>
              <SubmitButton>{copy.nextLabel} →</SubmitButton>
            </div>
          </form>
          <p className="text-sm text-ink/70 leading-relaxed">
            {buyerAgentComp.text[lang].planNote}
          </p>
          {/* Servicios legales: los "*" de los planes enlazan aquí. */}
          <LegalServicesDisclosure lang={lang} anchor />
        </div>
      )}

      {/* ─── Step 3: Details ─── */}
      {step === 3 && (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-2xl text-ink font-normal">
              {copy.step3.title}
            </h2>
            <p className="text-base leading-relaxed text-ink/70">
              {copy.step3.body}
            </p>
          </div>

          {/* Miami-Dade folio banner + auto-fill notice */}
          {draft?.folio && (
            <div className="border border-gold bg-gold/5 p-4 flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <span className="text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">
                  {copy.step3.folioLabel}
                </span>
                <span className="font-mono text-sm text-ink">
                  {draft.folio.length === 13
                    ? `${draft.folio.slice(0, 2)}-${draft.folio.slice(2, 6)}-${draft.folio.slice(6, 9)}-${draft.folio.slice(9)}`
                    : draft.folio}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                  {copy.step3.folioMatchedAddress}
                </span>
                <span className="text-sm text-ink/80">
                  {draft.address_street}, {draft.address_city}, {draft.address_state} {draft.address_zip}
                </span>
              </div>
            </div>
          )}
          {draft && draft.bedrooms > 0 && step3MiamiDade && (
            <SuccessBanner message={copy.step3.autoFilledNote} />
          )}
          {/* Only where Google places the address in Miami-Dade County. */}
          {draft && step3MiamiDade === false && step3County && (
            <p className="text-sm text-ink/70 border border-gold-soft bg-ivory-strong/40 p-5 leading-relaxed">
              {copy.step3.autofillOutsideCounty}
            </p>
          )}
          {draft && step3MiamiDade && (
            <div className="border border-gold-soft bg-ivory-strong/40 p-5 flex flex-col gap-3">
              <form action={autofillStep3}>
                <input type="hidden" name="id" value={draftId ?? ""} />
                <SecondaryButton>{copy.step3.autofillButton}</SecondaryButton>
              </form>
              <p className="text-xs text-ink/55 leading-relaxed">
                {copy.step3.autofillCaption}
              </p>
            </div>
          )}
          {autofillMessage && (
            autofillResult === "notfound" ? (
              <ErrorBanner message={autofillMessage} />
            ) : (
              <SuccessBanner message={autofillMessage} />
            )
          )}
          {suggestedFilledMessage && (
            <SuccessBanner message={suggestedFilledMessage} />
          )}

          {/* Rentcast sales comparables panel */}
          {draft && draft.price_comps_fetched_at && draft.price_comps && (
            <div className="border border-gold-soft p-6 flex flex-col gap-5">
              <div className="flex flex-col gap-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                  {copy.step3.compsEyebrow}
                </p>
                <h3 className="font-display text-2xl text-ink font-normal">
                  {copy.step3.compsTitle}
                </h3>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap border-b border-gold-soft pb-3">
                <span className="text-[11px] text-ink/55">
                  {copy.step3.compsUpdatedLabel}:{" "}
                  {new Date(draft.price_comps_fetched_at).toLocaleDateString(lang)}
                </span>
                <form action={refreshComps}>
                  <input type="hidden" name="id" value={draftId ?? ""} />
                  <button
                    type="submit"
                    className="text-[10px] uppercase tracking-[0.18em] text-gold border border-gold-soft px-3 py-1.5 hover:border-gold transition-colors"
                  >
                    {copy.step3.compsRefreshButton}
                  </button>
                </form>
              </div>
              <p className="text-[11px] text-ink/55 italic leading-snug -mt-2">
                {copy.step3.compsCacheNote}
              </p>

              {draft.price_estimate_low && draft.price_estimate_high && (
                <div className="flex flex-col gap-3 border-b border-gold-soft pb-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                      {copy.step3.compsEstimateLabel}
                    </span>
                    <div className="font-display italic text-3xl text-ink leading-none">
                      <span className="text-gold text-xl align-top">$</span>
                      {Math.round(
                        ((draft.price_estimate_low + draft.price_estimate_high) / 2) /
                          1000,
                      ).toLocaleString()}
                      <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55 font-sans not-italic ml-1">
                        K
                      </span>
                    </div>
                    <span className="text-xs text-ink/60">
                      {copy.step3.compsRangeLabel}: ${" "}
                      {draft.price_estimate_low.toLocaleString()}{" "}
                      {lang === "es" ? "a" : "to"} $
                      {draft.price_estimate_high.toLocaleString()}
                    </span>
                  </div>
                  <form action={useSuggestedPrice}>
                    <input type="hidden" name="id" value={draftId ?? ""} />
                    <button
                      type="submit"
                      className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink border border-gold px-4 py-2 hover:bg-gold hover:text-ink transition"
                    >
                      {copy.step3.useSuggestedButton}
                    </button>
                    <p className="text-[11px] text-ink/55 italic mt-2 leading-snug">
                      {copy.step3.useSuggestedCaption}
                    </p>
                  </form>
                </div>
              )}

              {draft.price_comps.length === 0 ? (
                <p className="text-sm text-ink/60 italic">
                  {copy.step3.compsEmpty}{" "}
                  {/* New tab: the step 3 form isn't saved yet. */}
                  <a
                    href={`/${lang}/consultations`}
                    target="_blank"
                    rel="noopener"
                    className="not-italic font-medium text-ink underline underline-offset-2 hover:text-gold"
                  >
                    {copy.step3.compsEmptyCta}
                  </a>
                </p>
              ) : (
                <>
                  <p className="text-xs text-ink/60 leading-relaxed">
                    {copy.step3.compsSubtitle.replace(
                      "{n}",
                      String(draft.price_comps.length),
                    )}
                  </p>
                  <div className="flex flex-col gap-3">
                    {draft.price_comps.map((c) => {
                      const dateStr = c.removedDate || c.lastSeenDate;
                      const daysAgo = dateStr
                        ? Math.floor(
                            // Relative "days ago" is inherently time-based; one
                            // read per render is correct for this display value.
                            // eslint-disable-next-line react-hooks/purity
                            (Date.now() - new Date(dateStr).getTime()) /
                              (1000 * 60 * 60 * 24),
                          )
                        : null;
                      return (
                        <div
                          key={c.formattedAddress}
                          className="border-t border-gold-soft pt-3 flex flex-col gap-1"
                        >
                          <div className="flex items-baseline justify-between gap-3 flex-wrap">
                            <span className="text-sm text-ink leading-snug">
                              {c.formattedAddress}
                            </span>
                            <span className="font-display text-lg text-ink">
                              ${c.price.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-ink/55 flex-wrap">
                            <span>
                              {copy.step3.compsSpecs
                                .replace("{beds}", String(c.bedrooms))
                                .replace("{baths}", String(c.bathrooms))
                                .replace("{sqft}", c.squareFootage.toLocaleString())}
                            </span>
                            <span className="text-gold-soft">·</span>
                            <span>
                              ${c.pricePerSqft}/{copy.step3.compsPerSqft}
                            </span>
                            <span className="text-gold-soft">·</span>
                            <span>
                              {c.distance.toFixed(2)} {copy.step3.compsMiles}
                            </span>
                            {daysAgo !== null && (
                              <>
                                <span className="text-gold-soft">·</span>
                                <span
                                  className={
                                    c.isSold ? "text-gold" : "text-ink/55"
                                  }
                                >
                                  {c.isSold
                                    ? copy.step3.compsSold
                                    : copy.step3.compsActive}{" "}
                                  · {copy.step3.compsDaysAgo.replace("{n}", String(daysAgo))}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {errorMessage && <ErrorBanner message={errorMessage} />}
          <form action={saveStep3} noValidate className="flex flex-col gap-6">
            <AppFormValidation step={3} lang={lang} message={copy.stepErrors.checkMarked}
              labels={copy.validation}
              fieldMessages={copy.fieldErrors}
            />
            <input type="hidden" name="id" value={draftId ?? ""} />

            <label className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
                {copy.step3.propertyTypeLabel}
                {draft?.folio && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-semibold tracking-[0.18em] text-gold bg-gold/10 border border-gold/40 px-2 py-0.5">
                    <span aria-hidden>✓</span>
                    {copy.step3.autofilledBadge}
                  </span>
                )}
              </span>
              <select
                name="property_type"
                defaultValue={draft?.property_type ?? "single_family"}
                className="bg-ivory border-2 border-gold-soft focus:border-gold outline-none px-4 py-3 text-base text-ink"
              >
                {PROPERTY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {copy.step3.types[t]}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <Field
                label={copy.step3.bedroomsLabel}
                name="bedrooms"
                type="text"
                defaultValue={draft?.bedrooms ? String(draft.bedrooms) : ""}
                autofilled={!!draft?.folio}
                autofilledLabel={copy.step3.autofilledBadge}
              />
              <Field
                label={copy.step3.bathroomsLabel}
                name="bathrooms"
                type="text"
                defaultValue={
                  draft?.bathrooms ? String(draft.bathrooms) : ""
                }
                autofilled={!!draft?.folio}
                autofilledLabel={copy.step3.autofilledBadge}
              />
              <Field
                label={copy.step3.yearBuiltLabel}
                name="year_built"
                type="text"
                defaultValue={
                  draft?.year_built &&
                  draft.year_built > 1800 &&
                  // Borradores viejos nacían con el año actual: en uno sin tocar no es un dato.
                  (draft.year_built < new Date().getFullYear() || draft.bedrooms > 0 || draft.sqft > 0)
                    ? String(draft.year_built)
                    : ""
                }
                autofilled={!!draft?.folio}
                autofilledLabel={copy.step3.autofilledBadge}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <Field
                label={copy.step3.sqftLabel}
                name="sqft"
                type="text"
                defaultValue={draft?.sqft ? String(draft.sqft) : ""}
                autofilled={!!draft?.folio}
                autofilledLabel={copy.step3.autofilledBadge}
              />
              <Field
                label={copy.step3.lotSizeLabel}
                name="lot_size"
                type="text"
                required={false}
                defaultValue={
                  draft?.lot_size ? String(draft.lot_size) : ""
                }
                autofilled={!!draft?.folio}
                autofilledLabel={copy.step3.autofilledBadge}
              />
            </div>

            <Field
              label={copy.step3.listPriceLabel}
              name="list_price"
              type="text"
              defaultValue={
                draft?.list_price ? String(draft.list_price) : ""
              }
            />

            {/* Optional details */}
            <div className="border-t border-gold-soft pt-8 flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <h3 className="font-display text-xl text-ink font-normal">
                  {copy.step3.moreSectionTitle}
                </h3>
                <p className="text-sm text-ink/65 leading-relaxed">
                  {copy.step3.moreSectionBody}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field
                  label={copy.step3.parkingLabel}
                  name="parking_spaces"
                  type="text"
                  required={false}
                  defaultValue={
                    draft?.parking_spaces != null
                      ? String(draft.parking_spaces)
                      : ""
                  }
                />
                <Field
                  label={copy.step3.hoaLabel}
                  name="hoa_fee"
                  type="text"
                  required={false}
                  defaultValue={
                    draft?.hoa_fee != null ? String(draft.hoa_fee) : ""
                  }
                />
                <Field
                  label={copy.step3.taxLabel}
                  name="tax_annual_amount"
                  type="text"
                  required={false}
                  defaultValue={
                    draft?.tax_annual_amount != null
                      ? String(draft.tax_annual_amount)
                      : ""
                  }
                  help={copy.step3.taxEstimateHint}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
                    {copy.step3.floodZoneLabel}
                  </span>
                  <select
                    name="flood_zone"
                    defaultValue={draft?.flood_zone ?? ""}
                    className="bg-ivory border-2 border-gold-soft px-4 py-3 text-base text-ink focus:outline-none focus:border-gold"
                  >
                    <option value="">{copy.step3.notSpecifiedOption}</option>
                    <option value="X">{copy.step3.floodZoneOptionX}</option>
                    <option value="AE">{copy.step3.floodZoneOptionAE}</option>
                    <option value="VE">{copy.step3.floodZoneOptionVE}</option>
                    <option value="A">{copy.step3.floodZoneOptionA}</option>
                    <option value="AH">{copy.step3.floodZoneOptionAH}</option>
                    <option value="AO">{copy.step3.floodZoneOptionAO}</option>
                    <option value="V">{copy.step3.floodZoneOptionV}</option>
                    <option value="D">{copy.step3.floodZoneOptionD}</option>
                    <option value="UNKNOWN">
                      {copy.step3.floodZoneOptionUnknown}
                    </option>
                  </select>
                </label>
                <p className="text-xs text-ink/55 leading-relaxed">
                  {copy.step3.floodZoneHelp}
                </p>
              </div>

              <FinancingSection
                initialTerms={draft ? savedFinancing(draft) : []}
                initialOther={draft?.financing_other ?? ""}
                labels={{
                  title: copy.step3.financingTitle,
                  help: copy.step3.financingHelp,
                  options: copy.step3.financingOptions,
                  otherLabel: copy.step3.financingOtherLabel,
                  otherPlaceholder: copy.step3.financingOtherPlaceholder,
                }}
              />

              <OccupancySection
                initialOccupancy={draft?.occupancy_status ?? ""}
                initialRent={
                  draft?.monthly_rent != null ? String(draft.monthly_rent) : ""
                }
                initialLeaseEnd={isoToUsDate(draft?.lease_end_date)}
                initialLeaseUnknown={draft?.occupancy_status === "tenant_occupied" && !draft?.lease_end_date}
                initialCooperation={
                  (draft?.tenant_cooperation ?? "") as
                    | ""
                    | "cooperative"
                    | "advance_notice"
                    | "difficult"
                }
                initialNotes={draft?.tenant_notes ?? ""}
                labels={{
                  occupancyLabel: copy.step3.occupancyLabel,
                  occupancyVacant: copy.step3.occupancyVacant,
                  occupancyOwner: copy.step3.occupancyOwner,
                  occupancyTenant: copy.step3.occupancyTenant,
                  leaseInfoTitle: copy.step3.leaseInfoTitle,
                  monthlyRentLabel: copy.step3.monthlyRentLabel,
                  leaseEndLabel: copy.step3.leaseEndLabel,
                  leaseEndPlaceholder: copy.step3.leaseEndPlaceholder,
                  leaseEndHelp: copy.step3.leaseEndHelp,
                  leaseEndUnknown: copy.step3.leaseEndUnknown,
                  tenantCoopLabel: copy.step3.tenantCoopLabel,
                  coopCooperative: copy.step3.coopCooperative,
                  coopAdvanceNotice: copy.step3.coopAdvanceNotice,
                  coopDifficult: copy.step3.coopDifficult,
                  tenantNotesLabel: copy.step3.tenantNotesLabel,
                  tenantNotesPlaceholder: copy.step3.tenantNotesPlaceholder,
                  occupancyPlaceholder: copy.step3.occupancyPlaceholder,
                }}
              />

              <fieldset className="flex flex-col gap-3 border border-gold-soft p-4">
                <legend className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55 px-2">
                  {copy.step3.boolGroupLabel}
                </legend>
                <label className="flex items-center gap-3 text-sm text-ink/80 cursor-pointer">
                  <input
                    type="checkbox"
                    name="has_pool"
                    value="1"
                    defaultChecked={draft?.has_pool ?? false}
                    className="accent-gold w-4 h-4"
                  />
                  <span>{copy.step3.poolLabel}</span>
                </label>
                <label className="flex items-center gap-3 text-sm text-ink/80 cursor-pointer">
                  <input
                    type="checkbox"
                    name="as_is_sale"
                    value="1"
                    defaultChecked={draft?.as_is_sale ?? false}
                    className="accent-gold w-4 h-4"
                  />
                  <span>{copy.step3.asIsLabel}</span>
                </label>
              </fieldset>

              <fieldset className="flex flex-col gap-3 border border-gold-soft p-4">
                <legend className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55 px-2">
                  {copy.step3.appliancesTitle}
                </legend>
                <p className="text-xs text-ink/55 leading-relaxed">
                  {copy.step3.appliancesBody}
                </p>
                <CheckAllToggle name="appliances" label={copy.step3.appliancesMarkAll} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  {APPLIANCE_KEYS.map((key) => (
                    <label
                      key={key}
                      className="flex items-center gap-3 text-sm text-ink/80 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        name="appliances"
                        value={key}
                        defaultChecked={draft?.appliances?.includes(key) ?? false}
                        className="accent-gold w-4 h-4"
                      />
                      <span>{copy.step3.appliances[key]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-3 text-sm text-ink/80 cursor-pointer">
                  <input
                    type="checkbox"
                    name="show_phone_on_portals"
                    value="1"
                    defaultChecked={draft?.show_phone_on_portals ?? false}
                    className="accent-gold w-4 h-4"
                  />
                  <span>{copy.step3.showPhoneLabel}</span>
                </label>
                <p className="text-xs text-ink/55 leading-relaxed pl-7">
                  {copy.step3.showPhoneHelp}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <Link
                href={`/${lang}/listing/new?step=2&id=${draftId}`}
                className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
              >
                ← {copy.backLabel}
              </Link>
              <SubmitButton>{copy.nextLabel} →</SubmitButton>
            </div>
          </form>
        </div>
      )}

      {/* ─── Step 4: Description + AI improve (per-field button) ─── */}
      {step === 4 && (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-2xl text-ink font-normal">
              {copy.step4.title}
            </h2>
            <p className="text-base leading-relaxed text-ink/70">
              {copy.step4.body}
            </p>
          </div>
          {errorMessage && <ErrorBanner message={errorMessage} />}
          {improvedFlag === "description" && (
            <SuccessBanner message={copy.step4.improvedDescriptionNotice} />
          )}
          {improvedFlag === "showing" && (
            <SuccessBanner message={copy.step4.improvedShowingNotice} />
          )}
          <form action={saveStep4} noValidate className="flex flex-col gap-8">
            <AppFormValidation step={4} lang={lang} message={copy.stepErrors.checkMarked}
              labels={copy.validation}
              fieldMessages={copy.fieldErrors}
            />
            <input type="hidden" name="id" value={draftId ?? ""} />

            {/* Description block + per-field improve button */}
            <div className="flex flex-col gap-3">
              <TextareaField
                label={copy.step4.descriptionLabel}
                name="description"
                defaultValue={draft?.description ?? ""}
                rows={8}
                help={copy.step4.descriptionHelp}
              />
              <div className="self-start">
                <SecondaryButton name="action" value="improve_description">
                  {copy.step4.improveDescriptionButton}
                </SecondaryButton>
              </div>
            </div>

            {/* Showing instructions block + per-field improve button */}
            <div className="flex flex-col gap-3">
              <TextareaField
                label={copy.step4.showingLabel}
                name="showing_instructions"
                defaultValue={draft?.showing_instructions ?? ""}
                rows={3}
                required={false}
                help={copy.step4.showingHelp}
              />
              <div className="self-start">
                <SecondaryButton name="action" value="improve_showing">
                  {copy.step4.improveShowingButton}
                </SecondaryButton>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 sm:gap-6 border-t border-gold-soft pt-6">
              <Link
                href={`/${lang}/listing/new?step=3&id=${draftId}`}
                className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors self-center sm:self-start mt-2"
              >
                ← {copy.backLabel}
              </Link>
              <SubmitButton name="action" value="next">
                {copy.nextLabel} →
              </SubmitButton>
            </div>
          </form>
        </div>
      )}

      {/* ─── Step 5: Photos ─── */}
      {step === 5 && (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <h2 className="font-display text-2xl text-ink font-normal">
                {copy.step5.title}
              </h2>
              <span
                className={`text-[10px] uppercase tracking-[0.22em] ${
                  photos.length < requiredPhotos
                    ? "text-ink/55"
                    : "text-gold font-semibold"
                }`}
              >
                {(photos.length >= requiredPhotos
                  ? copy.step5.photoCountReachedLabel
                  : copy.step5.photoCountLabel
                )
                  .replace("{count}", String(photos.length))
                  .replace("{min}", String(requiredPhotos))}
              </span>
            </div>
            <p className="text-base leading-relaxed text-ink/70">
              {photosRequired
                ? copy.step5.body.replace("{min}", String(MIN_OWN_PHOTOS))
                : photographyPaid && draft?.pricing_tier === "essentials"
                  ? copy.step5.bodyPhotographyPaid
                  : copy.step5.bodyPro}
            </p>
            <p className="text-sm leading-relaxed text-ink/70">{copy.step5.noMarksNote}</p>
          </div>

          {errorMessage && <FocusedErrorBanner key={`${sp.error}-${sp.n ?? ""}`} message={errorMessage} />}
          {sp.uploaded && (
            <SuccessBanner
              message={
                Number(sp.uploaded) === 1
                  ? copy.step5.uploadedNoticeOne
                  : copy.step5.uploadedNotice.replace("{n}", String(sp.uploaded))
              }
            />
          )}
          {sp.deleted === "1" && (
            <SuccessBanner message={copy.step5.deletedNotice} />
          )}
          {sp.primary === "1" && (
            <SuccessBanner message={copy.step5.primaryUpdatedNotice} />
          )}

          {/* Pro/Concierge: professional photography included banner */}
          {(draft?.pricing_tier === "pro" ||
            draft?.pricing_tier === "concierge") && (
            <div className="border border-gold bg-gold/5 p-5 flex flex-col gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                {copy.step5.proIncludedTitle}
              </p>
              <p className="text-sm text-ink/80 leading-relaxed">
                {fillPricingCopy(copy.step5.proIncludedBody)}
              </p>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/70 pt-2 border-t border-gold-soft">
                {copy.step5.proPhotosOr}
              </p>
            </div>
          )}

          {/* Essentials with the add-on already paid: no second checkout. */}
          {draft?.pricing_tier === "essentials" && photographyPaid && (
            <div className="border border-gold bg-gold/5 p-5 flex flex-col gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                {copy.step5.photoAddon.purchasedTitle}
              </p>
              <p className="text-sm text-ink/80 leading-relaxed">
                {copy.step5.photoAddon.purchasedBody}
              </p>
            </div>
          )}

          {/* Essentials: optional professional-photography add-on ($495) */}
          {draft?.pricing_tier === "essentials" && !photographyPaid && draftId && (
            <div className="border border-gold-soft bg-ivory-strong/30 p-5 flex flex-col gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                {copy.step5.photoAddon.title}
              </p>
              <p className="text-sm text-ink/80 leading-relaxed">
                {fillPricingCopy(copy.step5.photoAddon.body)}
              </p>
              <div className="border-t border-gold-soft pt-3">
                <PhotographyCheckoutButton
                  propertyId={draftId}
                  lang={lang}
                  label={fillPricingCopy(copy.step5.photoAddon.cta)}
                  labels={{
                    redirecting: copy.step5.photoAddon.redirecting,
                    failed: copy.step5.photoAddon.failed,
                  }}
                />
              </div>
            </div>
          )}

          {/* Upload form — direct-to-Supabase to bypass Vercel 4.5MB cap */}
          <PhotoUploader
            propertyId={draftId ?? ""}
            persistAction={uploadPhotosAction}
            labels={{
              uploading: copy.step5.uploadingNote,
              invalidFormat: copy.step5.invalidFormat,
              genericError: copy.step5.uploadFailed,
              partialFail: copy.step5.photoPartialFail,
              chooseFiles: copy.step5.chooseFiles,
              autoUploadHint: copy.step5.autoUploadHint,
              notAuthenticated: copy.step5.notAuthenticated,
              tooLarge: copy.step5.uploadTooLarge,
              reasonTooLarge: copy.step5.uploadReasonTooLarge,
              reasonGeneric: copy.step5.uploadReasonGeneric,
            }}
          />

          {/* Virtual Staging teaser — friendlier how-it-works copy */}
          <div className="border border-gold-soft p-5 flex flex-col gap-3 bg-ivory-strong/30">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              {copy.step5.stagingTitle}
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/70">
              {copy.step5.stagingHow}
            </p>
            <ol className="flex flex-col gap-2 text-sm text-ink/80 leading-relaxed list-decimal list-inside marker:text-gold">
              <li>{copy.step5.stagingStep1}</li>
              <li>{copy.step5.stagingStep2}</li>
              <li>{copy.step5.stagingStep3}</li>
            </ol>
            <p className="text-xs text-ink/55 italic leading-relaxed border-t border-gold-soft pt-3">
              {copy.step5.stagingPricing}
            </p>
          </div>

          {/* 3D / premium video tour — coaching + "in preparation" (no upload yet) */}
          <TourCoaching copy={copy.step5.tourCoach} />

          {/* Photo grid + ownership disclaimer + Next — visually grouped */}
          <form
            action={nextFromStep5}
            noValidate
            className="border border-gold-soft p-5 lg:p-6 flex flex-col gap-6 bg-ivory"
          >
            <AppFormValidation step={5} lang={lang} message={copy.stepErrors.checkMarked}
              labels={copy.validation}
              fieldMessages={copy.fieldErrors}
            />
            <input type="hidden" name="id" value={draftId ?? ""} />
            {photos.length === 0 ? (
              <p className="text-sm text-ink/60 italic">
                {copy.step5.emptyState}
              </p>
            ) : (
              <PhotoGridDraggable
                propertyId={draftId ?? ""}
                initialPhotos={photos}
                persistAction={reorderPhotosAction}
                deleteAction={deletePhotoAction}
                labels={{
                  primaryBadge: copy.step5.primaryBadge,
                  deleteButton: copy.step5.deleteButton,
                  reorderHint: copy.step5.photoReorderHint,
                  stageButton: copy.step5.stageButton,
                  stagingNow: copy.step5.stagingNow,
                  stagingFailed: copy.step5.stagingFailed,
                  stagedBadge: copy.step5.stagedBadge,
                  pickStyle: copy.step5.pickStyle,
                  cancelStyle: copy.step5.cancelStyle,
                  styleModern: copy.step5.styleModern,
                  styleMinimalist: copy.step5.styleMinimalist,
                  styleTraditional: copy.step5.styleTraditional,
                  styleWarm: copy.step5.styleWarm,
                  creditsTitle: copy.step5.stagingCredits.title,
                  creditsBody: copy.step5.stagingCredits.body,
                  creditsCta: copy.step5.stagingCredits.cta,
                  creditsRedirecting: copy.step5.stagingCredits.redirecting,
                  livingButton: copy.step5.living.button,
                  livingGenerating: copy.step5.living.generating,
                  livingFailed: copy.step5.living.failed,
                  livingView: copy.step5.living.view,
                  stagingRateLimited: copy.step5.stagingRateLimited,
                  livingRateLimited: copy.step5.living.rateLimited,
                }}
              />
            )}

            {/* Ownership disclaimer — sits inside the same card as the grid */}
            <div className="border border-gold-soft bg-ivory-strong/40 p-4 flex flex-col gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink">
                {copy.step5.ownershipTitle}
              </p>
              <p className="text-sm text-ink/80 leading-relaxed">
                {copy.step5.ownershipIntro}
              </p>
              <ul className="flex flex-col gap-2 text-sm text-ink/70 leading-relaxed">
                <li className="flex items-start gap-3">
                  <span aria-hidden className="text-gold mt-1 leading-none">•</span>
                  <span>{copy.step5.ownershipBullet1}</span>
                </li>
                <li className="flex items-start gap-3">
                  <span aria-hidden className="text-gold mt-1 leading-none">•</span>
                  <span>{copy.step5.ownershipBullet2}</span>
                </li>
                <li className="flex items-start gap-3">
                  <span aria-hidden className="text-gold mt-1 leading-none">•</span>
                  <span>{copy.step5.ownershipBullet3}</span>
                </li>
              </ul>
              <p className="text-xs text-ink/55 italic leading-relaxed border-t border-gold-soft pt-3">
                {copy.step5.ownershipWarning}
              </p>
            </div>

            <label className="flex items-start gap-3 text-sm text-ink/80 leading-relaxed cursor-pointer">
              <input
                type="checkbox"
                name="photos_rights_confirmed"
                value="1"
                required
                defaultChecked={sp.rights === "1"}
                className="mt-1 accent-gold w-4 h-4 shrink-0"
              />
              <span>{copy.step5.ownershipCheckLabel}</span>
            </label>
            <div className="flex items-center gap-6">
              <Link
                href={`/${lang}/listing/new?step=4&id=${draftId}`}
                className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
              >
                ← {copy.backLabel}
              </Link>
              <SubmitButton>{copy.nextLabel} →</SubmitButton>
            </div>
          </form>
        </div>
      )}

      {/* ─── Step 6: Review ─── */}
      {step === 6 && draft && (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-2xl text-ink font-normal">
              {copy.step6.title}
            </h2>
            <p className="text-base leading-relaxed text-ink/70">
              {copy.step6.body}
            </p>
          </div>

          {(() => {
            const tier = draft.pricing_tier
              ? PRICING_TIERS[draft.pricing_tier]
              : null;
            const tierCopy = draft.pricing_tier
              ? t(lang).pricing.tiers[draft.pricing_tier]
              : null;
            const primaryPhoto = photos.find((p) => p.is_primary);
            const incomplete =
              !draft.address_street ||
              !draft.pricing_tier ||
              draft.bedrooms === 0 ||
              draft.sqft === 0 ||
              draft.list_price === 0 ||
              !draft.description ||
              photos.length < requiredPhotos;

            const SectionHeader = ({
              title,
              editStep,
            }: {
              title: string;
              editStep: number;
            }) => (
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                  {title}
                </h3>
                <Link
                  href={`/${lang}/listing/new?step=${editStep}&id=${draftId}`}
                  className="text-[10px] uppercase tracking-[0.18em] text-ink/55 hover:text-gold transition-colors"
                >
                  {copy.step6.editLink}
                </Link>
              </div>
            );

            return (
              <>
                {errorMessage && !buyerCompError(sp.error) && <ErrorBanner message={errorMessage} />}
                {incomplete && (
                  <ErrorBanner message={copy.step6.incompleteWarn} />
                )}

                {/* Address */}
                <div className="border border-gold-soft p-5">
                  <SectionHeader title={copy.step6.sectionAddress} editStep={1} />
                  {draft.address_street ? (
                    <div className="flex flex-col gap-1 text-sm text-ink">
                      <span>{draft.address_street}</span>
                      <span className="text-ink/60">
                        {draft.address_city}, {draft.address_state}{" "}
                        {draft.address_zip}
                      </span>
                      {draft.latitude && draft.longitude && (
                        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/45 mt-1">
                          ✓ {copy.step6.addressVerified} · {draft.latitude.toFixed(4)},{" "}
                          {draft.longitude.toFixed(4)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-ink/55 italic">
                      {copy.step6.emptySection}
                    </p>
                  )}
                </div>

                {/* Plan */}
                <div className="border border-gold-soft p-5">
                  <SectionHeader title={copy.step6.sectionPlan} editStep={2} />
                  {tier && tierCopy ? (
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <div className="flex flex-col gap-1">
                        <span className="font-display text-lg text-ink">
                          {tierCopy.name}
                        </span>
                        <span className="text-xs text-ink/60">
                          {tierCopy.tagline}
                        </span>
                      </div>
                      <div className="text-right text-sm text-ink">
                        <div className="font-display italic">
                          <span className="text-gold">$</span>
                          {tier.flatFee}{" "}
                          <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55 not-italic font-sans">
                            {copy.step6.flatLabel}
                          </span>
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                          + {tier.commissionPct}% {copy.step6.commissionLabel} ·{" "}
                          {copy.step6.termLabel}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-ink/55 italic">
                      {copy.step6.emptySection}
                    </p>
                  )}
                </div>

                {/* Details */}
                <div className="border border-gold-soft p-5">
                  <SectionHeader
                    title={copy.step6.sectionDetails}
                    editStep={3}
                  />
                  {draft.bedrooms > 0 && draft.sqft > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                          {copy.step6.typeLabel}
                        </span>
                        <span className="text-ink">
                          {(copy.step3.types as Record<string, string>)[
                            draft.property_type
                          ] ?? draft.property_type.replace("_", " ")}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                          {copy.step6.bedsBathsLabel}
                        </span>
                        <span className="text-ink">
                          {copy.step6.bedsBathsValue
                            .replace("{beds}", String(draft.bedrooms))
                            .replace("{baths}", String(draft.bathrooms))}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                          {copy.step6.sqftLabel}
                        </span>
                        <span className="text-ink">
                          {draft.sqft.toLocaleString()}
                          {draft.lot_size && (
                            <span className="text-ink/55 text-xs ml-1">
                              ·{" "}
                              {copy.step6.lotValue.replace(
                                "{n}",
                                draft.lot_size.toLocaleString(),
                              )}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                          {copy.step6.builtLabel}
                        </span>
                        <span className="text-ink">{draft.year_built ?? "—"}</span>
                      </div>
                      {(draft.parking_spaces != null ||
                        draft.hoa_fee != null ||
                        draft.tax_annual_amount != null ||
                        draft.flood_zone ||
                        draft.occupancy_status ||
                        draft.has_pool ||
                        draft.cash_only ||
                        draft.as_is_sale) && (
                        <div className="col-span-2 sm:col-span-4 border-t border-gold-soft pt-3 mt-1 flex flex-wrap gap-x-6 gap-y-2 text-xs text-ink/75">
                          {draft.parking_spaces != null && (
                            <span>
                              🚗{" "}
                              {copy.step6.parkingValue.replace(
                                "{n}",
                                String(draft.parking_spaces),
                              )}
                            </span>
                          )}
                          {draft.hoa_fee != null && (
                            <span>
                              🏢{" "}
                              {copy.step6.hoaValue.replace(
                                "{amount}",
                                draft.hoa_fee.toLocaleString(),
                              )}
                            </span>
                          )}
                          {draft.tax_annual_amount != null && (
                            <span>
                              🧾{" "}
                              {copy.step6.taxValue.replace(
                                "{amount}",
                                draft.tax_annual_amount.toLocaleString(),
                              )}
                            </span>
                          )}
                          {draft.flood_zone && (
                            <span>
                              🌊{" "}
                              {draft.flood_zone === "UNKNOWN"
                                ? copy.step6.floodZoneUnknown
                                : copy.step6.floodZoneValue.replace(
                                    "{zone}",
                                    draft.flood_zone,
                                  )}
                            </span>
                          )}
                          {draft.occupancy_status && (
                            <span>
                              🏠{" "}
                              {draft.occupancy_status === "vacant"
                                ? copy.step3.occupancyVacant
                                : draft.occupancy_status === "owner_occupied"
                                  ? copy.step3.occupancyOwner
                                  : copy.step3.occupancyTenant}
                            </span>
                          )}
                          {draft.has_pool && <span>🏊 {copy.step6.poolTag}</span>}
                          {draft.cash_only && <span>💵 {copy.step6.cashOnlyTag}</span>}
                          {draft.as_is_sale && <span>📋 {copy.step6.asIsTag}</span>}
                        </div>
                      )}
                      {draft.appliances && draft.appliances.length > 0 && (
                        <p className="mt-3 text-xs text-ink/70 leading-relaxed">
                          <span className="text-ink/50">
                            {copy.step6.appliancesLabel}:{" "}
                          </span>
                          {draft.appliances
                            .map(
                              (a) =>
                                (copy.step3.appliances as Record<string, string>)[
                                  a
                                ],
                            )
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-ink/55 italic">
                      {copy.step6.emptySection}
                    </p>
                  )}
                </div>

                {/* Description + showings */}
                <div className="border border-gold-soft p-5">
                  <SectionHeader
                    title={copy.step6.sectionDescription}
                    editStep={4}
                  />
                  {draft.description ? (
                    <div className="flex flex-col gap-4">
                      <p className="text-sm leading-relaxed text-ink/80 whitespace-pre-wrap">
                        {draft.description}
                      </p>
                      <div className="border-t border-gold-soft pt-3">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                          {copy.step6.showingsLabel}:
                        </span>{" "}
                        <span className="text-sm text-ink/80">
                          {draft.showing_instructions ?? copy.step6.noShowings}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-ink/55 italic">
                      {copy.step6.emptySection}
                    </p>
                  )}
                </div>

                {/* Photos */}
                <div className="border border-gold-soft p-5">
                  <SectionHeader title={copy.step6.sectionPhotos} editStep={5} />
                  {photos.length > 0 ? (
                    <>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55 mb-3">
                        {copy.step6.photosCountLabel
                          .replace("{n}", String(photos.length))
                          .replace(
                            "{primary}",
                            primaryPhoto
                              ? copy.step6.primarySet
                              : copy.step6.primaryNone,
                          )}
                      </p>
                      {/* Clarity: las fotos del inmueble van enmascaradas (solo miniaturas, sin botones). */}
                      <div data-clarity-mask="true" className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                        {photos.slice(0, 12).map((p) => (
                          <div
                            key={p.id}
                            className="relative aspect-square overflow-hidden bg-ivory-strong"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={p.url}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                            {p.is_primary && (
                              <div className="absolute top-1 left-1 bg-gold text-ink text-[7px] font-semibold tracking-wider uppercase px-1 py-0.5">
                                P
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-ink/55 italic">
                      {/* Todos los planes necesitan al menos la foto del frente. */}
                      {copy.step6.emptySection}
                    </p>
                  )}
                </div>

                {/* List price + comps */}
                <div className="border border-gold-soft p-5">
                  <SectionHeader
                    title={copy.step6.sectionPricing}
                    editStep={3}
                  />
                  {draft.list_price > 0 ? (
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <div className="font-display italic text-3xl text-ink">
                        <span className="text-gold text-lg align-top">$</span>
                        {draft.list_price.toLocaleString()}
                      </div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                        {draft.price_estimate_low && draft.price_estimate_high
                          ? copy.step6.compsCount
                              .replace(
                                "{n}",
                                String(draft.price_comps?.length ?? 0),
                              )
                              .replace(
                                "{range}",
                                `${draft.price_estimate_low.toLocaleString()} ${lang === "es" ? "a" : "to"} $${draft.price_estimate_high.toLocaleString()}`,
                              )
                          : copy.step6.compsNone}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-ink/55 italic">
                      {copy.step6.emptySection}
                    </p>
                  )}
                </div>

                {/* Oferta al agente del comprador + desglose: se guardan al continuar */}
                {(() => {
                  const saved = offerFromRow(draft);
                  const initial = saved ?? suggestedOffer(draft.pricing_tier);
                  const comp = buyerAgentComp.text[lang];
                  const c6 = copy.step6;
                  return (
                    <form action={nextFromStep6} className="flex flex-col gap-8">
                      <input type="hidden" name="id" value={draftId ?? ""} />
                      <BuyerCompStep
                        copy={{
                          ...c6.buyerComp,
                          title: comp.stepTitle,
                          body: comp.stepBody,
                          noticeOffer: comp.noticeOffer,
                          noticeNoOffer: comp.noticeNoOffer,
                          conciergeSuggested: comp.conciergeSuggested,
                          costEyebrow: c6.costEyebrow,
                          costToday: c6.costToday,
                          costAtClosing: c6.costAtClosing,
                          costBuyerAgent: c6.costBuyerAgent,
                          costTotal: c6.costTotal,
                          costTraditional: c6.costTraditional,
                          costSavings: c6.costSavings,
                          costNote: c6.costNote,
                        }}
                        tierId={isPricingTierId(draft.pricing_tier) ? draft.pricing_tier : null}
                        commissionPct={tier?.commissionPct ?? null}
                        traditionalListingPct={TRADITIONAL_COSTS.listingCommissionPct}
                        listPrice={Number(draft.list_price ?? 0)}
                        initialChoice={offerChoice(initial)}
                        initialCustomKind={initial?.type === "amount" ? "amount" : "percent"}
                        initialCustomValue={
                          initial && offerChoice(initial) === "custom"
                            ? initial.type === "amount"
                              ? String(initial.amount)
                              : initial.type === "percent"
                                ? String(initial.pct)
                                : ""
                            : ""
                        }
                        conciergeSuggested={draft.pricing_tier === "concierge"}
                        error={buyerCompError(sp.error)}
                      />

                      {/* Continue */}
                      <div className="border-t border-gold-soft pt-8 flex flex-col gap-4">
                        <h3 className="font-display text-xl text-ink">
                          {copy.step6.readyTitle}
                        </h3>
                        <p className="text-sm text-ink/70 leading-relaxed">
                          {copy.step6.readyBody}
                        </p>
                        <div className="flex items-center gap-6">
                          <Link
                            href={`/${lang}/listing/new?step=5&id=${draftId}`}
                            className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
                          >
                            ← {copy.backLabel}
                          </Link>
                          <SubmitButton>{copy.step6.continueButton}</SubmitButton>
                        </div>
                      </div>
                    </form>
                  );
                })()}
              </>
            );
          })()}
        </div>
      )}

      {/* ─── Step 7: Agreement (DocuSign) ─── */}
      {step === 7 && draftId && (
        <div className="flex flex-col gap-8">
          {/* Ya firmado: solo la confirmación, sin la instrucción de firmar (auditoría #07). */}
          {(needsAccount || !agreementSignedBySeller(latestAgreement?.status)) && (
            <div className="flex flex-col gap-3">
              <h2 className="font-display text-2xl text-ink font-normal">
                {copy.step7.title}
              </h2>
              <p className="text-base leading-relaxed text-ink/70">
                {copy.step7.body}
              </p>
            </div>
          )}

          {needsAccount ? (
            <AccountGate
              registerAction={registerAccount}
              verifyAction={verifyEmailCode}
              resendAction={resendEmailCode}
              lang={lang}
              draftId={draftId}
              pendingEmail={pendingEmail}
              knownEmail={accountPending ? (sessionUser?.email ?? null) : null}
              termsConsent={{ parts: consentCheckbox("terms", lang), version: CONSENTS.terms.version }}
              resentAt={
                typeof sp.resent === "string" ? Number.parseInt(sp.resent, 10) : null
              }
              error={typeof sp.aerror === "string" ? sp.aerror : null}
              codeError={typeof sp.cerror === "string" ? sp.cerror : null}
              labels={{
                createEyebrow: copy.step7.gateCreateEyebrow,
                createTitle: copy.step7.gateCreateTitle,
                createBody: copy.step7.gateCreateBody,
                firstNameLabel: copy.step7.gateFirstName,
                lastNameLabel: copy.step7.gateLastName,
                emailLabel: copy.step7.gateEmail,
                passwordLabel: copy.step7.gatePassword,
                passwordHint: copy.step7.gatePasswordHint,
                submitLabel: copy.step7.gateSubmit,
                showPassword: copy.step7.gateShowPassword,
                hidePassword: copy.step7.gateHidePassword,
                confirmEyebrow: copy.step7.gateConfirmEyebrow,
                confirmTitle: copy.step7.gateConfirmTitle,
                confirmBody: copy.step7.gateConfirmBody,
                codeLabel: copy.step7.gateCodeLabel,
                codeHint: copy.step7.gateCodeHint,
                codeSubmit: copy.step7.gateCodeSubmit,
                resendPrompt: copy.step7.gateResendPrompt,
                resendCta: copy.step7.gateResendCta,
                resendSending: copy.step7.gateResendSending,
                resendCooldown: copy.step7.gateResendCooldown,
                resendDone: copy.step7.gateResendDone,
                errResendLimit: copy.step7.gateErrResendLimit,
                errResendFailed: copy.step7.gateErrResendFailed,
                errCaptcha: t(lang).auth.errors.captchaFailed,
                errName: copy.step7.gateErrName,
                errEmail: copy.step7.gateErrEmail,
                errPassword: copy.step7.gateErrPassword,
                errExists: copy.step7.gateErrExists,
                errFailed: copy.step7.gateErrFailed,
                errTerms: t(lang).auth.errors.termsRequired,
                otherAccountLabel: copy.step7.gateOtherAccount,
                errLeaked: t(lang).auth.errors.leakedPassword,
                errRejected: t(lang).auth.errors.passwordRejected,
                errCodeFormat: copy.step7.gateErrCodeFormat,
                errCodeInvalid: copy.step7.gateErrCodeInvalid,
              }}
            />
          ) : (
            (() => {
            const agStatus = latestAgreement?.status ?? null;
            const isSigned = agreementSignedBySeller(agStatus);

            if (isSigned) {
              return (
                <div className="border border-gold bg-gold/5 p-6 flex flex-col gap-4">
                  <h2 className="font-display text-2xl text-ink font-normal">
                    {copy.step7.signedTitle}
                  </h2>
                  <p className="text-base text-ink leading-relaxed">
                    {copy.step7.signedBody}
                  </p>
                  <Link
                    href={`/${lang}/listing/new?step=8&id=${draftId}`}
                    className="self-start inline-flex items-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
                  >
                    {copy.step7.continueButton}
                  </Link>
                </div>
              );
            }

            if (agStatus === "declined" || agStatus === "voided" || agStatus === "expired") {
              return (
                <div className="flex flex-col gap-4">
                  <div className="border border-red-300 bg-red-50 p-5 flex flex-col gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-red-800">
                      {copy.step7.declinedTitle}
                    </p>
                    <p className="text-sm text-red-800 leading-relaxed">
                      {copy.step7.declinedBody}
                    </p>
                  </div>
                  <AgreementButton
                    propertyId={draftId}
                    lang={lang}
                    labels={{
                      startButton: copy.step7.restartButton,
                      redirecting: copy.step7.redirecting,
                      failed: copy.step7.failed,
                      consentRequired: copy.step7.consentRequired,
                    }}
                    esign={esignProps}
                  />
                </div>
              );
            }

            if (agStatus === "sent" || agStatus === "delivered") {
              return (
                <div className="flex flex-col gap-4">
                  <div className="border border-gold-soft bg-ivory-strong/40 p-5 flex flex-col gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/70">
                      {copy.step7.sentTitle}
                    </p>
                    <p className="text-sm text-ink/70 leading-relaxed">
                      {copy.step7.sentBody}
                    </p>
                  </div>
                  {sp.signed === "1" && (
                    <AgreementStatusPoller
                      propertyId={draftId}
                      label={copy.step7.pollingLabel}
                    />
                  )}
                  <AgreementButton
                    propertyId={draftId}
                    lang={lang}
                    labels={{
                      startButton: copy.step7.reopenButton,
                      redirecting: copy.step7.redirecting,
                      failed: copy.step7.failed,
                      consentRequired: copy.step7.consentRequired,
                    }}
                    esign={esignProps}
                  />
                </div>
              );
            }

            // No agreement yet — show the start button.
            return (
              <AgreementButton
                propertyId={draftId}
                lang={lang}
                labels={{
                  startButton: copy.step7.startButton,
                  redirecting: copy.step7.redirecting,
                  failed: copy.step7.failed,
                  consentRequired: copy.step7.consentRequired,
                }}
                esign={esignProps}
              />
            );
            })()
          )}

          <Link
            href={`/${lang}/listing/new?step=6&id=${draftId}`}
            className="self-start text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
          >
            ← {copy.backLabel}
          </Link>
        </div>
      )}

      {/* ─── Step 8: Payment (Stripe Checkout) ─── */}
      {step === 8 && draft && draftId && (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-2xl text-ink font-normal">
              {copy.step8.title}
            </h2>
            <p className="text-base leading-relaxed text-ink/70">
              {copy.step8.body}
            </p>
          </div>

          {sp.error === "cancelled" && (
            <ErrorBanner message={copy.step8.cancelledNotice} />
          )}

          {(() => {
            const tierId =
              draft.pricing_tier && draft.pricing_tier in PRICING_TIERS
                ? draft.pricing_tier
                : null;
            const tier = tierId ? PRICING_TIERS[tierId] : null;
            const agreementOk =
              latestAgreement?.status === "signed" ||
              latestAgreement?.status === "completed";

            // Gate: agreement must be signed before payment is allowed.
            if (!agreementOk) {
              return (
                <div className="border border-gold-soft bg-ivory-strong/40 p-6 flex flex-col gap-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/70">
                    {copy.step8.agreementBlockedTitle}
                  </p>
                  <p className="text-base text-ink/80 leading-relaxed">
                    {copy.step8.agreementBlockedBody}
                  </p>
                  <Link
                    href={`/${lang}/listing/new?step=7&id=${draftId}`}
                    className="self-start inline-flex items-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
                  >
                    {copy.step8.backToAgreement}
                  </Link>
                </div>
              );
            }

            // Success path: payment succeeded OR property already advanced.
            const isSucceeded =
              latestPayment?.status === "succeeded" ||
              draft.mls_status === "pending_approval" ||
              draft.mls_status === "active";
            if (isSucceeded) {
              return (
                <DashboardRedirect
                  href={`/${lang}/dashboard`}
                  title={copy.step8.successTitle}
                  body={`${copy.step8.successBody} ${publicationTimeline.text[lang].sentence}`}
                  redirectingLabel={copy.step8.redirectingDashboard}
                  manualLabel={copy.step8.viewDashboard}
                />
              );
            }

            // Failed/declined payment → clear notice + retry (takes precedence
            // over the pending poller so the seller isn't stuck on a spinner).
            const paymentFailed = latestPayment?.status === "failed";

            // Pending path: returned from Stripe but webhook hasn't landed yet.
            // Auto-poll until mls_status flips, then re-render the success card.
            if (sp.session_id && !paymentFailed) {
              return (
                <div className="border border-gold-soft bg-ivory-strong/40 p-6 flex flex-col gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/70">
                    {copy.step8.pendingTitle}
                  </p>
                  <p className="text-sm text-ink/70 leading-relaxed">
                    {copy.step8.pendingBody}
                  </p>
                  <PaymentStatusPoller
                    propertyId={draftId}
                    label={copy.step8.pollingLabel}
                  />
                </div>
              );
            }

            if (!tierId || !tier) {
              return (
                <p className="text-sm text-ink/60 italic">
                  {copy.step8.tierMissing}
                </p>
              );
            }

            return (
              <div className="flex flex-col gap-6">
                {paymentFailed && (
                  <ErrorBanner message={copy.step8.failedNotice} />
                )}
                <div className="border border-gold-soft p-6 flex flex-col gap-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                      {copy.step8.tierLabel}
                    </span>
                    <span className="font-display text-xl text-ink">
                      {t(lang).pricing.tiers[tierId].name}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-t border-gold-soft pt-3">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                      {copy.step8.amountLabel}
                    </span>
                    <span className="font-display italic text-3xl text-ink leading-none">
                      <span className="text-gold text-xl align-top">$</span>
                      {tier.flatFee}
                    </span>
                  </div>
                  <p className="text-xs text-ink/55 leading-relaxed">
                    {copy.step8.feeNote.replace(
                      "{pct}",
                      String(tier.commissionPct),
                    )}
                  </p>
                  {/* Plazo y reembolso: los mismos textos que Términos, FAQ y correos */}
                  <p className="text-xs text-ink/70 leading-relaxed">
                    {publicationTimeline.text[lang].sentence}
                  </p>
                  <p className="text-xs text-ink/70 leading-relaxed">
                    {refundPolicy.text[lang]}
                  </p>
                </div>

                <CheckoutButton
                  propertyId={draftId}
                  lang={lang}
                  planTier={isPlanTier(draft?.pricing_tier) ? draft.pricing_tier : null}
                  value={isPlanTier(draft?.pricing_tier) ? PRICING_TIERS[draft.pricing_tier].flatFee : null}
                  labels={{
                    payButton: copy.step8.payButton,
                    redirecting: copy.step8.redirecting,
                    failed: copy.step8.failed,
                    confirming: copy.step8.confirmingExisting,
                    consentRequired: copy.step8.consentRequired,
                  }}
                  // Casilla del paso 8 con el precio y la comisión del plan (consents.ts).
                  refundAck={
                    isPlanTier(draft?.pricing_tier)
                      ? {
                          parts: consentCheckbox("terms_refund", lang, draft.pricing_tier),
                          version: CONSENTS.terms_refund.version,
                        }
                      : null
                  }
                />

                <Link
                  href={`/${lang}/listing/new?step=7&id=${draftId}`}
                  className="self-start text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
                >
                  ← {copy.backLabel}
                </Link>
              </div>
            );
          })()}
        </div>
      )}
    </StepShell>
  );
}
