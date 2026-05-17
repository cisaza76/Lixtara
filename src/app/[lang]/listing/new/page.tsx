import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { isLocale, t } from "@/lib/i18n";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { StepShell } from "@/components/step-shell";
import { Field, SubmitButton, ErrorBanner } from "@/components/auth-shell";

const TOTAL_STEPS = 8;

function clampStep(value: number): number {
  return Math.min(Math.max(value, 1), TOTAL_STEPS);
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

  // Load existing draft if id is present so we can pre-fill Step 1.
  let draft: {
    id: string;
    address_street: string;
    address_city: string;
    address_state: string;
    address_zip: string;
  } | null = null;
  if (draftId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("properties")
      .select("id,address_street,address_city,address_state,address_zip")
      .eq("id", draftId)
      .eq("mls_status", "draft")
      .maybeSingle();
    draft = data ?? null;
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
      // Update existing draft
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

    // Create new draft. Schema requires bedrooms/bathrooms/sqft/year_built/
    // list_price/property_type — we set placeholders that Steps 2-3 overwrite.
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

  const errorMessage =
    sp.error === "required"
      ? "All fields are required."
      : sp.error === "fl_only"
        ? copy.step1.flOnly
        : sp.error === "save_failed"
          ? "Could not save. Please try again."
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
      {step === 1 ? (
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
                  required
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
      ) : (
        <div className="flex flex-col gap-6">
          <h2 className="font-display text-2xl text-ink font-normal">
            {copy.stepNames[step - 1]}
          </h2>
          <p className="text-base leading-relaxed text-ink/70">
            {draftId ? copy.placeholderStepLater : copy.placeholderStep}
          </p>
          <div className="flex gap-4">
            {step > 1 && (
              <Link
                href={`/${lang}/listing/new?step=${step - 1}${draftId ? `&id=${draftId}` : ""}`}
                className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
              >
                ← {copy.backLabel}
              </Link>
            )}
          </div>
        </div>
      )}
    </StepShell>
  );
}
