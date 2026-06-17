import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { isLocale, t } from "@/lib/i18n";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
  type PricingTierId,
} from "@/lib/pricing-tiers";
import {
  improveListingDescription,
  improveShowingInstructions,
} from "@/lib/ai";
import { lookupMiamiDadeProperty } from "@/lib/miami-dade";
import { fetchRentcastEstimate, type RentcastComp } from "@/lib/rentcast";
import { deletePropertyPhoto, storagePathFromUrl } from "@/lib/storage";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { validateUsAddress } from "@/lib/geocode";
import { TourCoaching } from "@/components/tour-coaching";
import { PhotographyCheckoutButton } from "@/components/photography-checkout-button";
import { PhotoUploader } from "@/components/photo-uploader";
import { OccupancySection } from "@/components/occupancy-section";
import { PhotoGridDraggable } from "@/components/photo-grid-draggable";
import { CheckoutButton } from "@/components/checkout-button";
import { PaymentStatusPoller } from "@/components/payment-status-poller";
import { DashboardRedirect } from "@/components/dashboard-redirect";
import { AgreementButton } from "@/components/agreement-button";
import { AgreementStatusPoller } from "@/components/agreement-status-poller";

const TOTAL_STEPS = 8;
const PROPERTY_TYPES = [
  "single_family",
  "condo",
  "townhouse",
  "multi_family",
] as const;

function clampStep(value: number): number {
  return Math.min(Math.max(value, 1), TOTAL_STEPS);
}

// Strip a trailing unit/apt token so county + comps lookups match the building
// (the stored address keeps the unit for contracts/forms).
function baseStreetForLookup(street: string): string {
  return street
    .replace(/[,\s]*\b(?:unit|apt|apartment|suite|ste|#)\b.*$/i, "")
    .trim();
}

type OccupancyStatus = "vacant" | "owner_occupied" | "tenant_occupied";

interface Draft {
  id: string;
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
  year_built: number;
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
    deleted?: string;
    primary?: string;
    success?: string;
    suggested_tier?: string;
    session_id?: string;
    signed?: string;
    event?: string;
  }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  await requireUser(lang, "/listing/new");

  const sp = await searchParams;
  const step = clampStep(Number.parseInt(sp.step ?? "1", 10) || 1);
  const draftId = sp.id ?? null;
  const copy = t(lang).listingForm;

  let draft: Draft | null = null;
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
        "id,address_street,address_city,address_state,address_zip,latitude,longitude,pricing_tier,mls_status,property_type,bedrooms,bathrooms,sqft,lot_size,year_built,list_price,description,showing_instructions,price_comps,price_estimate_low,price_estimate_high,price_comps_fetched_at,parking_spaces,hoa_fee,tax_annual_amount,has_pool,cash_only,as_is_sale,flood_zone,occupancy_status,monthly_rent,lease_end_date,tenant_cooperation,tenant_notes,show_phone_on_portals,folio,buyer_agent_commission",
      )
      .eq("id", draftId)
      .maybeSingle();
    draft = (data as Draft | null) ?? null;

    // Step 3 auto-fetch: Miami-Dade autofill (if zip is Miami-Dade + fields
    // still placeholders) + Rentcast comps (if not fetched yet). Runs server-
    // side on entry to Step 3 so the form pre-populates with real data + the
    // comps panel renders immediately.
    if (step === 3 && draft) {
      const tasks: Promise<unknown>[] = [];
      const updates: Record<string, unknown> = {};

      const isMiamiDade = /^33\d{3}$/.test(draft.address_zip);
      const fieldsEmpty =
        draft.bedrooms === 0 &&
        draft.sqft === 0 &&
        draft.year_built <= new Date().getFullYear();
      if (isMiamiDade && fieldsEmpty) {
        tasks.push(
          lookupMiamiDadeProperty(baseStreetForLookup(draft.address_street), draft.address_zip).then(
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
            if (rc) {
              updates.price_comps = rc.comps;
              updates.price_estimate_low = rc.priceLow;
              updates.price_estimate_high = rc.priceHigh;
              updates.price_comps_fetched_at = new Date().toISOString();
            } else {
              // Mark as fetched to avoid retrying on every page load. Empty
              // comps means "no data for this area" — user fills price manually.
              updates.price_comps = [];
              updates.price_comps_fetched_at = new Date().toISOString();
            }
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
      const { data: payRow } = await supabase
        .from("payments")
        .select("status, amount, tier")
        .eq("property_id", draftId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (payRow) latestPayment = payRow as PaymentRow;
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

    if (!baseStreet || !city || !zip) {
      redirect(`/${lang}/listing/new?step=1${id ? `&id=${id}` : ""}&error=required`);
    }
    if (state !== "FL") {
      redirect(`/${lang}/listing/new?step=1${id ? `&id=${id}` : ""}&error=fl_only`);
    }

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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    const addressUpdate = {
      address_street: street,
      address_city: city,
      address_state: state,
      address_zip: zip,
      latitude: finalLat,
      longitude: finalLng,
    };

    if (id) {
      const { error } = await supabase
        .from("properties")
        .update(addressUpdate)
        .eq("id", id)
        .eq("owner_id", user.id);
      if (error) {
        redirect(`/${lang}/listing/new?step=1&id=${id}&error=save_failed`);
      }
      redirect(`/${lang}/listing/new?id=${id}&step=2`);
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
        property_type: "single_family",
        bedrooms: 0,
        bathrooms: 1,
        sqft: 0,
        year_built: new Date().getFullYear(),
        list_price: 0,
        mls_status: "draft",
        ...(suggestedTier ? { pricing_tier: suggestedTier } : {}),
      })
      .select("id")
      .single();
    if (error || !created) {
      redirect(`/${lang}/listing/new?step=1&error=save_failed`);
    }
    redirect(`/${lang}/listing/new?id=${created.id}&step=2`);
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
    redirect(`/${lang}/listing/new?id=${id}&step=3`);
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
    const lotSize = lotSizeRaw === "" ? null : Number.parseInt(lotSizeRaw, 10);
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
    const cashOnly = formData.get("cash_only") === "1";
    const asIsSale = formData.get("as_is_sale") === "1";
    const floodZoneRaw = String(formData.get("flood_zone") ?? "")
      .trim()
      .toUpperCase();
    const floodZone = floodZoneRaw === "" ? null : floodZoneRaw.slice(0, 10);
    const occupancyRaw = String(formData.get("occupancy_status") ?? "");
    const occupancyStatus = (
      ["vacant", "owner_occupied", "tenant_occupied"] as const
    ).includes(occupancyRaw as OccupancyStatus)
      ? (occupancyRaw as OccupancyStatus)
      : null;
    const showPhone = formData.get("show_phone_on_portals") === "1";

    // Lease details — only persisted when a tenant occupies the property;
    // cleared to null otherwise so changing occupancy doesn't leave stale data.
    const isTenant = occupancyStatus === "tenant_occupied";
    const rentRaw = String(formData.get("monthly_rent") ?? "").trim();
    const monthlyRent =
      isTenant && rentRaw !== "" && Number.isFinite(Number(rentRaw))
        ? Number(rentRaw)
        : null;
    const leaseEndRaw = String(formData.get("lease_end_date") ?? "").trim();
    const leaseEndDate = isTenant && leaseEndRaw !== "" ? leaseEndRaw : null;
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
    if (bedrooms < 0 || bedrooms > 30) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=invalid_beds`);
    }
    if (bathrooms <= 0 || bathrooms > 30) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=invalid_baths`);
    }
    if (sqft <= 0 || sqft > 100000) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=invalid_sqft`);
    }
    if (yearBuilt < 1800 || yearBuilt > new Date().getFullYear() + 2) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=invalid_year`);
    }
    if (listPrice <= 0 || listPrice > 1000000000) {
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
        cash_only: cashOnly,
        as_is_sale: asIsSale,
        flood_zone: floodZone,
        occupancy_status: occupancyStatus,
        monthly_rent: monthlyRent,
        lease_end_date: leaseEndDate,
        tenant_cooperation: tenantCooperation,
        tenant_notes: tenantNotes,
        show_phone_on_portals: showPhone,
      })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=save_failed`);
    }
    redirect(`/${lang}/listing/new?id=${id}&step=4`);
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
    const update = rc
      ? {
          price_comps: rc.comps,
          price_estimate_low: rc.priceLow,
          price_estimate_high: rc.priceHigh,
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

    const result = await lookupMiamiDadeProperty(baseStreetForLookup(row.address_street), row.address_zip);
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
    redirect(`/${lang}/listing/new?id=${id}&step=5`);
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
    const tierId = prop?.pricing_tier as PricingTierId | null;
    const photosIncluded = !!(tierId && PRICING_TIERS[tierId]?.includesPhotography);

    const { count } = await supabase
      .from("property_photos")
      .select("id", { count: "exact", head: true })
      .eq("property_id", id);
    const photoCount = count ?? 0;

    // Pro/Concierge include professional photography, so a seller who uploads
    // none may skip the 10-photo minimum and the rights box. DIY (Essentials),
    // and anyone who DID upload, still confirm rights; Essentials still needs 10.
    const needsOwnPhotos = !photosIncluded;
    if (
      (needsOwnPhotos || photoCount > 0) &&
      formData.get("photos_rights_confirmed") !== "1"
    ) {
      redirect(`/${lang}/listing/new?step=5&id=${id}&error=rights_required`);
    }
    if (needsOwnPhotos && photoCount < 10) {
      redirect(`/${lang}/listing/new?step=5&id=${id}&error=not_enough`);
    }

    // Persist confirmation once migration 20260517_add_listing_extended_fields
    // is applied (column added there). Until then this is a no-op update.
    await supabase
      .from("properties")
      .update({ photos_rights_confirmed: true })
      .eq("id", id);

    redirect(`/${lang}/listing/new?step=6&id=${id}`);
  }

  async function setBuyerCommission(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const pct = Number(formData.get("buyer_agent_commission") ?? "0");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);
    if (![2, 2.5, 3].includes(pct)) {
      redirect(`/${lang}/listing/new?step=6&id=${id}&error=invalid_buyer_commission`);
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    await supabase
      .from("properties")
      .update({ buyer_agent_commission: pct })
      .eq("id", id)
      .eq("owner_id", user.id);

    // Revalidate in place instead of redirecting. A redirect navigates, and the
    // App Router scrolls to the top on navigation — yanking the seller away from
    // the picker every time they choose a commission. Revalidating refreshes the
    // current step server-side while preserving scroll position.
    revalidatePath(`/${lang}/listing/new`);
  }

  async function nextFromStep6(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);

    // Buyer-agent commission must be set before advancing to the agreement.
    const supabase = await createClient();
    const { data: prop } = await supabase
      .from("properties")
      .select("buyer_agent_commission")
      .eq("id", id)
      .maybeSingle();
    if (!prop?.buyer_agent_commission || prop.buyer_agent_commission === 0) {
      redirect(`/${lang}/listing/new?step=6&id=${id}&error=buyer_commission_required`);
    }

    redirect(`/${lang}/listing/new?step=7&id=${id}`);
  }

  const errorMessage =
    sp.error === "required"
      ? "All fields are required."
      : sp.error === "fl_only"
        ? copy.step1.flOnly
        : sp.error === "address_invalid"
          ? copy.step1.addressInvalid
        : sp.error === "invalid"
          ? "Please check the values."
          : sp.error === "invalid_type"
            ? "Pick a property type."
            : sp.error === "invalid_beds"
              ? "Bedrooms must be 0–30."
              : sp.error === "invalid_baths"
                ? "Bathrooms must be a number greater than 0 (e.g. 2 or 2.5)."
                : sp.error === "invalid_sqft"
                  ? "Square feet must be greater than 0."
                  : sp.error === "invalid_year"
                    ? "Year built must be 1800 to current year + 2."
                    : sp.error === "invalid_price"
                      ? "List price must be greater than 0 (in USD, no commas)."
                      : sp.error === "empty_improve"
                        ? copy.step4.emptyToImprove
                        : sp.error === "improve_failed"
                          ? copy.step4.improveFailed
                          : sp.error === "upload_failed"
                            ? copy.step5.uploadFailed
                            : sp.error === "not_enough"
                              ? copy.step5.notEnoughPhotos
                              : sp.error === "no_files"
                                ? copy.step5.invalidFormat
                                : sp.error === "save_failed"
                                  ? "Could not save. Please try again."
                                  : sp.error === "no_estimate"
                                    ? "No price estimate available yet."
                                    : sp.error === "rights_required"
                                      ? copy.step5.ownershipRequired
                                      : sp.error === "invalid_parking"
                                        ? "Parking spaces must be 0–50."
                                        : sp.error === "invalid_hoa"
                                          ? "HOA fee must be a non-negative dollar amount."
                                          : sp.error === "invalid_tax"
                                            ? "Property tax must be a non-negative dollar amount."
                                            : sp.error === "buyer_commission_required" ||
                                                sp.error === "invalid_buyer_commission"
                                              ? copy.step6.buyerCommissionRequired
                                              : null;
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
    >
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
          <form action={saveStep1} className="flex flex-col gap-6">
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
              unitLabel={copy.step1.unitLabel}
              cityLabel={copy.step1.cityLabel}
              stateLabel={copy.step1.stateLabel}
              zipLabel={copy.step1.zipLabel}
              defaultStreet={draft?.address_street ?? ""}
              defaultCity={draft?.address_city ?? "Miami"}
              defaultZip={draft?.address_zip ?? ""}
              defaultLat={draft?.latitude ?? null}
              defaultLng={draft?.longitude ?? null}
              verifiedNote={copy.step1.verifiedNote}
            />
            <SubmitButton>{copy.nextLabel} →</SubmitButton>
          </form>
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
          <form action={saveStep2} className="flex flex-col gap-6">
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
                              <span className="text-ink/80">{f}</span>
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
          {draft && draft.bedrooms > 0 && /^33\d{3}$/.test(draft.address_zip) && (
            <SuccessBanner message={copy.step3.autoFilledNote} />
          )}
          <div className="border border-gold-soft bg-ivory-strong/40 p-5 flex flex-col gap-3">
            <form action={autofillStep3}>
              <input type="hidden" name="id" value={draftId ?? ""} />
              <SecondaryButton>{copy.step3.autofillButton}</SecondaryButton>
            </form>
            <p className="text-xs text-ink/55 leading-relaxed">
              {copy.step3.autofillCaption}
            </p>
          </div>
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
                      {draft.price_estimate_low.toLocaleString()} – $
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
                  {copy.step3.compsEmpty}
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
                              {c.bedrooms}bd · {c.bathrooms}ba ·{" "}
                              {c.squareFootage.toLocaleString()}sqft
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
          <form action={saveStep3} className="flex flex-col gap-6">
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
                  draft?.year_built && draft.year_built > 1800
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
                  defaultValue={
                    draft?.hoa_fee != null ? String(draft.hoa_fee) : ""
                  }
                />
                <Field
                  label={copy.step3.taxLabel}
                  name="tax_annual_amount"
                  type="text"
                  defaultValue={
                    draft?.tax_annual_amount != null
                      ? String(draft.tax_annual_amount)
                      : ""
                  }
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
                    <option value="">—</option>
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

              <OccupancySection
                initialOccupancy={draft?.occupancy_status ?? ""}
                initialRent={
                  draft?.monthly_rent != null ? String(draft.monthly_rent) : ""
                }
                initialLeaseEnd={draft?.lease_end_date ?? ""}
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
                  tenantCoopLabel: copy.step3.tenantCoopLabel,
                  coopCooperative: copy.step3.coopCooperative,
                  coopAdvanceNotice: copy.step3.coopAdvanceNotice,
                  coopDifficult: copy.step3.coopDifficult,
                  tenantNotesLabel: copy.step3.tenantNotesLabel,
                  tenantNotesPlaceholder: copy.step3.tenantNotesPlaceholder,
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
                    name="cash_only"
                    value="1"
                    defaultChecked={draft?.cash_only ?? false}
                    className="accent-gold w-4 h-4"
                  />
                  <span>{copy.step3.cashOnlyLabel}</span>
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
          <form action={saveStep4} className="flex flex-col gap-8">
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
                  photos.length >= copy.minPhotos
                    ? "text-gold font-semibold"
                    : "text-ink/55"
                }`}
              >
                {(photos.length >= copy.minPhotos
                  ? copy.step5.photoCountReachedLabel
                  : copy.step5.photoCountLabel
                )
                  .replace("{count}", String(photos.length))
                  .replace("{min}", String(copy.minPhotos))}
              </span>
            </div>
            <p className="text-base leading-relaxed text-ink/70">
              {copy.step5.body}
            </p>
          </div>

          {errorMessage && <ErrorBanner message={errorMessage} />}
          {sp.uploaded && (
            <SuccessBanner
              message={`Uploaded ${sp.uploaded} ${
                Number(sp.uploaded) === 1 ? "photo" : "photos"
              }.`}
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
                {copy.step5.proIncludedBody}
              </p>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/70 pt-2 border-t border-gold-soft">
                {copy.step5.proPhotosOr}
              </p>
            </div>
          )}

          {(draft?.pricing_tier === "pro" ||
            draft?.pricing_tier === "concierge") && (
            <p className="text-xs text-ink/70 italic border border-gold-soft bg-ivory-strong/40 p-3">
              {copy.step5.photosOptionalPro}
            </p>
          )}

          {/* Essentials: optional professional-photography add-on ($495) */}
          {draft?.pricing_tier === "essentials" && draftId && (
            <div className="border border-gold-soft bg-ivory-strong/30 p-5 flex flex-col gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                {copy.step5.photoAddon.title}
              </p>
              <p className="text-sm text-ink/80 leading-relaxed">
                {copy.step5.photoAddon.body}
              </p>
              <div className="border-t border-gold-soft pt-3">
                <PhotographyCheckoutButton
                  propertyId={draftId}
                  lang={lang}
                  label={copy.step5.photoAddon.cta}
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
              uploadButton: copy.step5.uploadButton,
              uploading: copy.step5.uploadingNote,
              invalidFormat: copy.step5.invalidFormat,
              genericError: copy.step5.uploadFailed,
              partialFail: copy.step5.photoPartialFail,
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
            className="border border-gold-soft p-5 lg:p-6 flex flex-col gap-6 bg-ivory"
          >
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
                required={
                  photos.length > 0 ||
                  !(
                    draft?.pricing_tier === "pro" ||
                    draft?.pricing_tier === "concierge"
                  )
                }
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
              (!tier?.includesPhotography && photos.length < 10);

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
                          ✓ Verified · {draft.latitude.toFixed(4)},{" "}
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
                          Type
                        </span>
                        <span className="text-ink">
                          {draft.property_type.replace("_", " ")}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                          Beds / Baths
                        </span>
                        <span className="text-ink">
                          {draft.bedrooms} bd / {draft.bathrooms} ba
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
                              · lot {draft.lot_size.toLocaleString()}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                          {copy.step6.builtLabel}
                        </span>
                        <span className="text-ink">{draft.year_built}</span>
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
                            <span>🚗 {draft.parking_spaces} parking</span>
                          )}
                          {draft.hoa_fee != null && (
                            <span>
                              🏢 HOA ${draft.hoa_fee.toLocaleString()}/mo
                            </span>
                          )}
                          {draft.tax_annual_amount != null && (
                            <span>
                              🧾 Tax ${draft.tax_annual_amount.toLocaleString()}/yr
                            </span>
                          )}
                          {draft.flood_zone && (
                            <span>🌊 Flood zone {draft.flood_zone}</span>
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
                          {draft.has_pool && <span>🏊 Pool</span>}
                          {draft.cash_only && <span>💵 Cash only</span>}
                          {draft.as_is_sale && <span>📋 As-is</span>}
                        </div>
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
                              ? "set"
                              : copy.step6.primaryNone,
                          )}
                      </p>
                      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
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
                                `${draft.price_estimate_low.toLocaleString()}–${draft.price_estimate_high.toLocaleString()}`,
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

                {/* Buyer-agent compensation picker (item 16) */}
                {(() => {
                  const currentBuyerComm = Number(
                    draft.buyer_agent_commission ?? 0,
                  );
                  const opts = [
                    {
                      pct: 2,
                      title: copy.step6.buyer2Title,
                      subtitle: copy.step6.buyer2Subtitle,
                      tip: copy.step6.buyer2Tip,
                      recommended: false,
                    },
                    {
                      pct: 2.5,
                      title: copy.step6.buyer25Title,
                      subtitle: copy.step6.buyer25Subtitle,
                      tip: copy.step6.buyer25Tip,
                      recommended: false,
                    },
                    {
                      pct: 3,
                      title: copy.step6.buyer3Title,
                      subtitle: copy.step6.buyer3Subtitle,
                      tip: copy.step6.buyer3Tip,
                      recommended: true,
                    },
                  ];
                  return (
                    <div className="border-t border-gold-soft pt-8 flex flex-col gap-5">
                      <div className="flex flex-col gap-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                          {copy.step6.buyerCommissionEyebrow}
                        </p>
                        <h3 className="font-display text-2xl text-ink leading-tight">
                          {copy.step6.buyerCommissionTitle}
                        </h3>
                        <p className="text-sm text-ink/70 leading-relaxed">
                          {copy.step6.buyerCommissionBody}
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {opts.map((o) => {
                          const active = currentBuyerComm === o.pct;
                          return (
                            <form
                              key={o.pct}
                              action={setBuyerCommission}
                              className="flex"
                            >
                              <input
                                type="hidden"
                                name="id"
                                value={draftId ?? ""}
                              />
                              <input
                                type="hidden"
                                name="buyer_agent_commission"
                                value={o.pct}
                              />
                              <button
                                type="submit"
                                title={o.tip}
                                className={`flex-1 flex flex-col gap-1 p-5 border-2 text-left transition-colors relative ${
                                  active
                                    ? "border-gold bg-gold/10"
                                    : "border-gold-soft bg-ivory hover:border-gold/60"
                                }`}
                              >
                                <span className="font-display text-2xl text-ink leading-none">
                                  {o.title}
                                </span>
                                <span className="text-xs text-ink/60">
                                  {o.subtitle}
                                </span>
                                {o.recommended && !active && (
                                  <span className="absolute top-2 right-2 text-[9px] uppercase tracking-[0.18em] text-gold font-semibold">
                                    ★ {copy.step6.buyer3Recommended}
                                  </span>
                                )}
                                {active && (
                                  <span className="absolute top-2 right-2 text-[9px] uppercase tracking-[0.18em] text-gold font-semibold">
                                    ✓ {copy.step6.buyerCommissionSelected}
                                  </span>
                                )}
                                <p className="text-xs text-ink/55 leading-relaxed mt-2 border-t border-gold-soft pt-2">
                                  {o.tip}
                                </p>
                              </button>
                            </form>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Cost breakdown (item 17) */}
                {(() => {
                  const buyerPct = Number(draft.buyer_agent_commission ?? 0);
                  if (buyerPct === 0 || !tier) return null;
                  const price = draft.list_price ?? 0;
                  const lixCommission = price * (tier.commissionPct / 100);
                  const buyerCommission = price * (buyerPct / 100);
                  const lixTotal = tier.flatFee + lixCommission + buyerCommission;
                  const traditionalTotal = price * 0.06;
                  const savings = Math.max(0, traditionalTotal - lixTotal);
                  return (
                    <div className="border border-gold-soft p-6 flex flex-col gap-4">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                        {copy.step6.costEyebrow}
                      </p>
                      <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
                        <dt className="text-ink/70">{copy.step6.costToday}</dt>
                        <dd className="text-right text-ink font-display text-lg">
                          ${tier.flatFee.toLocaleString()}
                        </dd>
                        <dt className="text-ink/70">{copy.step6.costAtClosing}</dt>
                        <dd className="text-right text-ink font-display text-lg">
                          ${Math.round(lixCommission).toLocaleString()}{" "}
                          <span className="text-[10px] text-ink/55 ml-1">
                            ({tier.commissionPct}%)
                          </span>
                        </dd>
                        <dt className="text-ink/70">
                          {copy.step6.costBuyerAgent}
                        </dt>
                        <dd className="text-right text-ink font-display text-lg">
                          ${Math.round(buyerCommission).toLocaleString()}{" "}
                          <span className="text-[10px] text-ink/55 ml-1">
                            ({buyerPct}%)
                          </span>
                        </dd>
                        <dt className="text-ink font-semibold border-t border-gold-soft pt-3">
                          {copy.step6.costTotal}
                        </dt>
                        <dd className="text-right font-display italic text-2xl text-ink border-t border-gold-soft pt-3">
                          ${Math.round(lixTotal).toLocaleString()}
                        </dd>
                        <dt className="text-ink/55 text-xs">
                          {copy.step6.costTraditional}
                        </dt>
                        <dd className="text-right text-ink/55 text-sm line-through">
                          ${Math.round(traditionalTotal).toLocaleString()}
                        </dd>
                        <dt className="text-gold font-semibold border-t border-gold-soft pt-3">
                          {copy.step6.costSavings}
                        </dt>
                        <dd className="text-right font-display italic text-2xl text-gold border-t border-gold-soft pt-3">
                          ${Math.round(savings).toLocaleString()}
                        </dd>
                      </dl>
                      <p className="text-[10px] italic text-ink/55 leading-relaxed">
                        {copy.step6.costNote}
                      </p>
                    </div>
                  );
                })()}

                {/* Continue */}
                <div className="border-t border-gold-soft pt-8 flex flex-col gap-4">
                  <h3 className="font-display text-xl text-ink">
                    {copy.step6.readyTitle}
                  </h3>
                  <p className="text-sm text-ink/70 leading-relaxed">
                    {copy.step6.readyBody}
                  </p>
                  <form
                    action={nextFromStep6}
                    className="flex items-center gap-6"
                  >
                    <input type="hidden" name="id" value={draftId ?? ""} />
                    <Link
                      href={`/${lang}/listing/new?step=5&id=${draftId}`}
                      className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
                    >
                      ← {copy.backLabel}
                    </Link>
                    <SubmitButton>{copy.step6.continueButton}</SubmitButton>
                  </form>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ─── Step 7: Agreement (DocuSign) ─── */}
      {step === 7 && draftId && (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-2xl text-ink font-normal">
              {copy.step7.title}
            </h2>
            <p className="text-base leading-relaxed text-ink/70">
              {copy.step7.body}
            </p>
          </div>

          {(() => {
            const agStatus = latestAgreement?.status ?? null;
            const isSigned = agStatus === "signed" || agStatus === "completed";

            if (isSigned) {
              return (
                <div className="border border-gold bg-gold/5 p-6 flex flex-col gap-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                    {copy.step7.signedTitle}
                  </p>
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
                    }}
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
                    }}
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
                }}
              />
            );
          })()}

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
                  body={copy.step8.successBody}
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
                      {tierId.charAt(0).toUpperCase() + tierId.slice(1)}
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
                </div>

                <CheckoutButton
                  propertyId={draftId}
                  lang={lang}
                  labels={{
                    payButton: copy.step8.payButton,
                    redirecting: copy.step8.redirecting,
                    failed: copy.step8.failed,
                  }}
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
