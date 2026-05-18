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
import {
  uploadPropertyPhoto,
  deletePropertyPhoto,
  storagePathFromUrl,
} from "@/lib/storage";
import { AddressAutocomplete } from "@/components/address-autocomplete";

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

interface Draft {
  id: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  latitude: number | null;
  longitude: number | null;
  pricing_tier: PricingTierId | null;
  property_type: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  lot_size: number | null;
  year_built: number;
  list_price: number;
  description: string | null;
  showing_instructions: string | null;
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
  if (draftId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("properties")
      .select(
        "id,address_street,address_city,address_state,address_zip,latitude,longitude,pricing_tier,property_type,bedrooms,bathrooms,sqft,lot_size,year_built,list_price,description,showing_instructions",
      )
      .eq("id", draftId)
      .eq("mls_status", "draft")
      .maybeSingle();
    draft = (data as Draft | null) ?? null;

    if (step === 5) {
      const { data: photoRows } = await supabase
        .from("property_photos")
        .select("id,url,is_primary,display_order")
        .eq("property_id", draftId)
        .order("display_order", { ascending: true });
      photos = (photoRows ?? []) as typeof photos;
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

    if (
      !PROPERTY_TYPES.includes(propertyType as (typeof PROPERTY_TYPES)[number]) ||
      bedrooms < 0 ||
      bathrooms < 0 ||
      sqft <= 0 ||
      yearBuilt < 1800 ||
      yearBuilt > new Date().getFullYear() + 2 ||
      listPrice <= 0
    ) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=invalid`);
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
      })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) {
      redirect(`/${lang}/listing/new?step=3&id=${id}&error=save_failed`);
    }
    redirect(`/${lang}/listing/new?id=${id}&step=4`);
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
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/listing/new?step=1&error=required`);

    const files = formData.getAll("photos").filter(
      (f): f is File => f instanceof File && f.size > 0,
    );
    if (files.length === 0) {
      redirect(`/${lang}/listing/new?step=5&id=${id}&error=no_files`);
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/listing/new`);

    // Current max display_order so new uploads land at the end
    const { data: existing } = await supabase
      .from("property_photos")
      .select("display_order")
      .eq("property_id", id)
      .order("display_order", { ascending: false })
      .limit(1);
    let nextOrder = existing && existing.length > 0 ? existing[0].display_order + 1 : 0;
    const hasAnyExisting = (existing?.length ?? 0) > 0;

    let failed = 0;
    for (const file of files) {
      try {
        const { url } = await uploadPropertyPhoto(user.id, id, file);
        await supabase.from("property_photos").insert({
          property_id: id,
          url,
          is_primary: !hasAnyExisting && nextOrder === 0,
          display_order: nextOrder,
        });
        nextOrder += 1;
      } catch (e) {
        console.error("upload failed for", file.name, e);
        failed += 1;
      }
    }

    if (failed > 0 && failed === files.length) {
      redirect(`/${lang}/listing/new?step=5&id=${id}&error=upload_failed`);
    }
    redirect(`/${lang}/listing/new?step=5&id=${id}&uploaded=${files.length - failed}`);
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

    const supabase = await createClient();
    const { count } = await supabase
      .from("property_photos")
      .select("id", { count: "exact", head: true })
      .eq("property_id", id);

    if ((count ?? 0) < 10) {
      redirect(`/${lang}/listing/new?step=5&id=${id}&error=not_enough`);
    }
    redirect(`/${lang}/listing/new?step=6&id=${id}`);
  }

  const errorMessage =
    sp.error === "required"
      ? "All fields are required."
      : sp.error === "fl_only"
        ? copy.step1.flOnly
        : sp.error === "invalid"
          ? "Please check the values."
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

          {/* Miami-Dade autofill */}
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

          {/* Upload form */}
          <form
            action={uploadPhotosAction}
            encType="multipart/form-data"
            className="flex flex-col gap-4 border border-gold-soft p-5"
          >
            <input type="hidden" name="id" value={draftId ?? ""} />
            <input
              type="file"
              name="photos"
              multiple
              accept="image/jpeg,image/png,image/webp"
              required
              className="text-sm text-ink file:mr-4 file:py-2 file:px-4 file:border file:border-gold-soft file:bg-ivory file:text-ink file:text-[10px] file:font-semibold file:uppercase file:tracking-[0.22em] file:cursor-pointer hover:file:border-gold"
            />
            <SubmitButton>{copy.step5.uploadButton}</SubmitButton>
          </form>

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
            className="flex items-center gap-6 border-t border-gold-soft pt-6"
          >
            <input type="hidden" name="id" value={draftId ?? ""} />
            <Link
              href={`/${lang}/listing/new?step=4&id=${draftId}`}
              className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
            >
              ← {copy.backLabel}
            </Link>
            <SubmitButton>{copy.nextLabel} →</SubmitButton>
          </form>
        </div>
      )}

      {/* ─── Steps 6-8: placeholders ─── */}
      {step > 5 && (
        <div className="flex flex-col gap-6">
          <h2 className="font-display text-2xl text-ink font-normal">
            {copy.stepNames[step - 1]}
          </h2>
          <p className="text-base leading-relaxed text-ink/70">
            {draftId ? copy.placeholderStepLater : copy.placeholderStep}
          </p>
          <div className="flex gap-4">
            <Link
              href={`/${lang}/listing/new?step=${step - 1}${draftId ? `&id=${draftId}` : ""}`}
              className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
            >
              ← {copy.backLabel}
            </Link>
          </div>
        </div>
      )}
    </StepShell>
  );
}
