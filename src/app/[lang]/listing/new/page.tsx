import { notFound, redirect } from "next/navigation";
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
import { TourUploader } from "@/components/tour-uploader";
import { PhotoUploader } from "@/components/photo-uploader";
import { CheckoutButton } from "@/components/checkout-button";
import { PaymentStatusPoller } from "@/components/payment-status-poller";

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
  show_phone_on_portals: boolean | null;
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
  }> = [];
  type TourJobRow = { status: "uploading" | "queued" | "processing" | "ready" | "failed" | "expired" };
  type PaymentRow = {
    status: "pending" | "succeeded" | "failed" | "refunded";
    amount: number;
    tier: string | null;
  };
  let tourJob: TourJobRow | null = null;
  let latestPayment: PaymentRow | null = null;
  if (draftId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("properties")
      .select(
        "id,address_street,address_city,address_state,address_zip,latitude,longitude,pricing_tier,mls_status,property_type,bedrooms,bathrooms,sqft,lot_size,year_built,list_price,description,showing_instructions,price_comps,price_estimate_low,price_estimate_high,price_comps_fetched_at,parking_spaces,hoa_fee,tax_annual_amount,has_pool,cash_only,as_is_sale,flood_zone,occupancy_status,show_phone_on_portals",
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
          lookupMiamiDadeProperty(draft.address_street, draft.address_zip).then(
            (result) => {
              if (result.found && result.details) {
                const d = result.details;
                if (d.bedrooms != null) updates.bedrooms = d.bedrooms;
                if (d.bathrooms != null) updates.bathrooms = d.bathrooms;
                if (d.sqft != null) updates.sqft = d.sqft;
                if (d.lot_size != null) updates.lot_size = d.lot_size;
                if (d.year_built != null) updates.year_built = d.year_built;
                if (d.property_type != null)
                  updates.property_type = d.property_type;
              }
            },
          ),
        );
      }

      const compsEmpty = !draft.price_comps_fetched_at;
      if (compsEmpty) {
        tasks.push(
          fetchRentcastEstimate(
            draft.address_street,
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
        .select("id,url,is_primary,display_order")
        .eq("property_id", draftId)
        .order("display_order", { ascending: true });
      photos = (photoRows ?? []) as typeof photos;

      const { data: tourRow } = await supabase
        .from("tour_jobs")
        .select("status")
        .eq("property_id", draftId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (tourRow) tourJob = tourRow as TourJobRow;
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
    const street = String(formData.get("street") ?? "").trim();
    const city = String(formData.get("city") ?? "").trim();
    const state = String(formData.get("state") ?? "FL").trim().toUpperCase();
    const zip = String(formData.get("zip") ?? "").trim();
    const latRaw = String(formData.get("lat") ?? "").trim();
    const lngRaw = String(formData.get("lng") ?? "").trim();
    const latitude = latRaw ? Number.parseFloat(latRaw) : null;
    const longitude = lngRaw ? Number.parseFloat(lngRaw) : null;
    const id = String(formData.get("id") ?? "");

    if (!street || !city || !zip) {
      redirect(`/${lang}/listing/new?step=1${id ? `&id=${id}` : ""}&error=required`);
    }
    if (state !== "FL") {
      redirect(`/${lang}/listing/new?step=1${id ? `&id=${id}` : ""}&error=fl_only`);
    }

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
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
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
        show_phone_on_portals: showPhone,
      })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=save_failed`);
    }
    redirect(`/${lang}/listing/new?id=${id}&step=4`);
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

    const result = await lookupMiamiDadeProperty(row.address_street, row.address_zip);
    if (!result.found || !result.details) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&autofill=notfound`);
    }
    const d = result.details;
    const update: Record<string, number | string | null> = {};
    if (d.bedrooms != null) update.bedrooms = d.bedrooms;
    if (d.bathrooms != null) update.bathrooms = d.bathrooms;
    if (d.sqft != null) update.sqft = d.sqft;
    if (d.lot_size != null) update.lot_size = d.lot_size;
    if (d.year_built != null) update.year_built = d.year_built;
    if (d.property_type != null) update.property_type = d.property_type;

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
    let nextOrder =
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

    const rightsConfirmed = formData.get("photos_rights_confirmed") === "1";
    if (!rightsConfirmed) {
      redirect(`/${lang}/listing/new?step=5&id=${id}&error=rights_required`);
    }

    const supabase = await createClient();
    const { count } = await supabase
      .from("property_photos")
      .select("id", { count: "exact", head: true })
      .eq("property_id", id);

    if ((count ?? 0) < 10) {
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

  async function nextFromStep6(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);
    // Step 7 (Agreement) is still a placeholder (DocuSign blocked). Just
    // advance — no status change. Status flips to 'pending_approval' after
    // Step 8 (payment) when F2.2 lands.
    redirect(`/${lang}/listing/new?step=7&id=${id}`);
  }

  const errorMessage =
    sp.error === "required"
      ? "All fields are required."
      : sp.error === "fl_only"
        ? copy.step1.flOnly
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

          {/* Miami-Dade auto-fill notice (already ran on page entry) */}
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
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
                {copy.step3.propertyTypeLabel}
              </span>
              <select
                name="property_type"
                defaultValue={draft?.property_type ?? "single_family"}
                className="bg-transparent border-b border-gold-soft focus:border-gold outline-none py-2 text-base text-ink"
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
              />
              <Field
                label={copy.step3.bathroomsLabel}
                name="bathrooms"
                type="text"
                defaultValue={
                  draft?.bathrooms ? String(draft.bathrooms) : ""
                }
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
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <Field
                label={copy.step3.sqftLabel}
                name="sqft"
                type="text"
                defaultValue={draft?.sqft ? String(draft.sqft) : ""}
              />
              <Field
                label={copy.step3.lotSizeLabel}
                name="lot_size"
                type="text"
                required={false}
                defaultValue={
                  draft?.lot_size ? String(draft.lot_size) : ""
                }
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
                  <input
                    type="text"
                    name="flood_zone"
                    defaultValue={draft?.flood_zone ?? ""}
                    placeholder="X / AE / VE / …"
                    maxLength={10}
                    className="border border-gold-soft px-3 py-2 text-base text-ink bg-ivory focus:outline-none focus:border-gold uppercase"
                  />
                </label>
                <p className="text-xs text-ink/55 leading-relaxed">
                  {copy.step3.floodZoneHelp}
                </p>
              </div>

              <label className="flex flex-col gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
                  {copy.step3.occupancyLabel}
                </span>
                <select
                  name="occupancy_status"
                  defaultValue={draft?.occupancy_status ?? ""}
                  className="border border-gold-soft px-3 py-2 text-base text-ink bg-ivory focus:outline-none focus:border-gold"
                >
                  <option value="">—</option>
                  <option value="vacant">{copy.step3.occupancyVacant}</option>
                  <option value="owner_occupied">
                    {copy.step3.occupancyOwner}
                  </option>
                  <option value="tenant_occupied">
                    {copy.step3.occupancyTenant}
                  </option>
                </select>
              </label>

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

          {/* Photo ownership disclaimer */}
          <div className="border border-gold-soft bg-ivory-strong/40 p-5 flex flex-col gap-3">
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

          {/* Upload form — direct-to-Supabase to bypass Vercel 4.5MB cap */}
          <PhotoUploader
            propertyId={draftId ?? ""}
            persistAction={uploadPhotosAction}
            labels={{
              uploadButton: copy.step5.uploadButton,
              uploading: copy.step5.uploadingNote,
              invalidFormat: copy.step5.invalidFormat,
              genericError: copy.step5.uploadFailed,
            }}
          />

          {/* Virtual Staging teaser */}
          <div className="border border-gold-soft p-5 flex flex-col gap-2 bg-ivory-strong/30">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              {copy.step5.stagingTitle}
            </p>
            <p className="text-sm text-ink/70 leading-relaxed">
              {copy.step5.stagingBody}
            </p>
          </div>

          {/* 3D Walkthrough Tour (Pro + Concierge) */}
          <div className="border border-gold-soft p-5 flex flex-col gap-4 bg-ivory-strong/30">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              {copy.step5.tourTitle}
            </p>
            <p className="text-sm text-ink/70 leading-relaxed">
              {copy.step5.tourBody}
            </p>
            {draft?.pricing_tier === "pro" || draft?.pricing_tier === "concierge" ? (
              <>
                <p className="text-xs text-ink/55 leading-relaxed italic border-t border-gold-soft pt-3">
                  {copy.step5.tourCaptureGuide}
                </p>
                <TourUploader
                  propertyId={draftId ?? ""}
                  initialJob={tourJob}
                  labels={{
                    fileLabel: copy.step5.tourFileLabel,
                    uploadButton: copy.step5.tourUploadButton,
                    uploading: copy.step5.tourUploading,
                    queued: copy.step5.tourQueued,
                    processing: copy.step5.tourProcessing,
                    ready: copy.step5.tourReady,
                    failed: copy.step5.tourFailed,
                    expired: copy.step5.tourExpired,
                    replaceButton: copy.step5.tourReplaceButton,
                    fileTooLarge: copy.step5.tourFileTooLarge,
                    genericError: copy.step5.tourGenericError,
                  }}
                />
              </>
            ) : (
              <p className="text-xs text-ink/55 italic border-t border-gold-soft pt-3">
                {copy.step5.tourTierGate}
              </p>
            )}
          </div>

          {/* Photo grid */}
          {photos.length === 0 ? (
            <p className="text-sm text-ink/60 italic">
              {copy.step5.emptyState}
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  className="relative aspect-square overflow-hidden bg-ivory-strong border border-gold-soft group"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  {photo.is_primary && (
                    <div className="absolute top-2 left-2 bg-gold text-ink text-[9px] font-semibold tracking-[0.2em] uppercase px-2 py-1">
                      {copy.step5.primaryBadge}
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 to-ink/0 p-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!photo.is_primary && (
                      <form action={setPrimaryAction}>
                        <input type="hidden" name="id" value={draftId ?? ""} />
                        <input type="hidden" name="photo_id" value={photo.id} />
                        <button
                          type="submit"
                          className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ivory hover:text-gold"
                        >
                          {copy.step5.setPrimaryButton}
                        </button>
                      </form>
                    )}
                    <form action={deletePhotoAction} className="ml-auto">
                      <input type="hidden" name="id" value={draftId ?? ""} />
                      <input type="hidden" name="photo_id" value={photo.id} />
                      <input type="hidden" name="url" value={photo.url} />
                      <button
                        type="submit"
                        className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ivory hover:text-red-300"
                      >
                        {copy.step5.deleteButton}
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Next */}
          <form
            action={nextFromStep5}
            className="flex flex-col gap-5 border-t border-gold-soft pt-6"
          >
            <input type="hidden" name="id" value={draftId ?? ""} />
            <label className="flex items-start gap-3 text-sm text-ink/80 leading-relaxed cursor-pointer">
              <input
                type="checkbox"
                name="photos_rights_confirmed"
                value="1"
                required
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
              photos.length < 10;

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

      {/* ─── Step 7: Agreement (DocuSign placeholder until F2.2.B) ─── */}
      {step === 7 && (
        <div className="flex flex-col gap-6">
          <h2 className="font-display text-2xl text-ink font-normal">
            {copy.stepNames[step - 1]}
          </h2>
          <p className="text-base leading-relaxed text-ink/70">
            {draftId ? copy.placeholderStepLater : copy.placeholderStep}
          </p>
          <div className="flex gap-6 items-center">
            <Link
              href={`/${lang}/listing/new?step=6${draftId ? `&id=${draftId}` : ""}`}
              className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
            >
              ← {copy.backLabel}
            </Link>
            {draftId && (
              <Link
                href={`/${lang}/listing/new?step=8&id=${draftId}`}
                className="text-[10px] uppercase tracking-[0.22em] text-gold hover:text-ink transition-colors"
              >
                {copy.nextLabel} →
              </Link>
            )}
          </div>
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

            // Success path: payment succeeded OR property already advanced.
            const isSucceeded =
              latestPayment?.status === "succeeded" ||
              draft.mls_status === "pending_approval" ||
              draft.mls_status === "active";
            if (isSucceeded) {
              return (
                <div className="border border-gold bg-gold/5 p-6 flex flex-col gap-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                    {copy.step8.successTitle}
                  </p>
                  <p className="text-base text-ink leading-relaxed">
                    {copy.step8.successBody}
                  </p>
                  <Link
                    href={`/${lang}/properties`}
                    className="self-start inline-flex items-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
                  >
                    {copy.step8.viewDashboard}
                  </Link>
                </div>
              );
            }

            // Pending path: returned from Stripe but webhook hasn't landed yet.
            // Auto-poll until mls_status flips, then re-render the success card.
            if (sp.session_id) {
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
                    label="Waiting for confirmation"
                  />
                </div>
              );
            }

            if (!tierId || !tier) {
              return (
                <p className="text-sm text-ink/60 italic">
                  Pricing tier not set — go back to Step 2.
                </p>
              );
            }

            return (
              <div className="flex flex-col gap-6">
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
