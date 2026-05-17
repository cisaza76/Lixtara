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
import { improveListingDescription } from "@/lib/ai";

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
  searchParams: Promise<{ step?: string; id?: string; error?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  await requireUser(lang, "/listing/new");

  const sp = await searchParams;
  const step = clampStep(Number.parseInt(sp.step ?? "1", 10) || 1);
  const draftId = sp.id ?? null;
  const copy = t(lang).listingForm;

  let draft: Draft | null = null;
  if (draftId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("properties")
      .select(
        "id,address_street,address_city,address_state,address_zip,pricing_tier,property_type,bedrooms,bathrooms,sqft,lot_size,year_built,list_price,description,showing_instructions",
      )
      .eq("id", draftId)
      .eq("mls_status", "draft")
      .maybeSingle();
    draft = (data as Draft | null) ?? null;
  }

  async function saveStep1(formData: FormData) {
    "use server";
    const street = String(formData.get("street") ?? "").trim();
    const city = String(formData.get("city") ?? "").trim();
    const state = String(formData.get("state") ?? "FL").trim().toUpperCase();
    const zip = String(formData.get("zip") ?? "").trim();
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

    if (id) {
      const { error } = await supabase
        .from("properties")
        .update({
          address_street: street,
          address_city: city,
          address_state: state,
          address_zip: zip,
        })
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
        address_street: street,
        address_city: city,
        address_state: state,
        address_zip: zip,
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

    if (action === "improve") {
      if (description.length < 10) {
        redirect(`/${lang}/listing/new?step=4&id=${id}&error=empty_improve`);
      }
      // Load current facts from DB (the draft passed via form may be stale).
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
        console.error("improve failed", e);
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
      redirect(`/${lang}/listing/new?step=4&id=${id}&improved=1`);
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
              : sp.error === "save_failed"
                ? "Could not save. Please try again."
                : null;
  const improvedFlag =
    typeof sp === "object" && "improved" in sp && sp.improved === "1";

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
            <Field
              label={copy.step1.streetLabel}
              name="street"
              defaultValue={draft?.address_street ?? ""}
              autoComplete="street-address"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <Field
                label={copy.step1.cityLabel}
                name="city"
                defaultValue={draft?.address_city ?? "Miami"}
                autoComplete="address-level2"
              />
              <div className="grid grid-cols-2 gap-6">
                <Field
                  label={copy.step1.stateLabel}
                  name="state"
                  defaultValue="FL"
                  autoComplete="address-level1"
                />
                <Field
                  label={copy.step1.zipLabel}
                  name="zip"
                  defaultValue={draft?.address_zip ?? ""}
                  autoComplete="postal-code"
                />
              </div>
            </div>
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
                const tierCopy =
                  t(lang).pricing.tiers[tierId];
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
                    <div className="flex-1 flex flex-col gap-2">
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

      {/* ─── Step 4: Description + AI improve ─── */}
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
          {improvedFlag && <SuccessBanner message={copy.step4.improvedNotice} />}
          <form action={saveStep4} className="flex flex-col gap-6">
            <input type="hidden" name="id" value={draftId ?? ""} />
            <TextareaField
              label={copy.step4.descriptionLabel}
              name="description"
              defaultValue={draft?.description ?? ""}
              rows={8}
              help={copy.step4.descriptionHelp}
            />
            <TextareaField
              label={copy.step4.showingLabel}
              name="showing_instructions"
              defaultValue={draft?.showing_instructions ?? ""}
              rows={3}
              required={false}
              help={copy.step4.showingHelp}
            />
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 sm:gap-6">
              <Link
                href={`/${lang}/listing/new?step=3&id=${draftId}`}
                className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors self-center sm:self-start mt-2"
              >
                ← {copy.backLabel}
              </Link>
              <SecondaryButton name="action" value="improve">
                ✨ {copy.step4.improveButton}
              </SecondaryButton>
              <SubmitButton name="action" value="next">
                {copy.nextLabel} →
              </SubmitButton>
            </div>
          </form>
        </div>
      )}

      {/* ─── Steps 5-8: placeholders ─── */}
      {step > 4 && (
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
