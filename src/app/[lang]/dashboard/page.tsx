import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { isLocale, t, type Locale } from "@/lib/i18n";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPrice, PRICING_TIERS, type PricingTierId } from "@/lib/pricing-tiers";

interface ListingRow {
  id: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  list_price: number;
  pricing_tier: string | null;
  mls_status: string;
  created_at: string;
}

interface PhotoRow {
  property_id: string;
  url: string;
  is_primary: boolean;
  display_order: number;
}

interface PaymentRow {
  property_id: string;
  status: string;
  created_at: string;
}

interface AgreementRow {
  property_id: string;
  status: string;
}

interface TourJobRow {
  property_id: string;
  status: string;
}

function paymentLabel(
  payments: PaymentRow[],
  copy: ReturnType<typeof t>["dashboard"],
): { text: string; tone: "ok" | "warn" | "fail" | "none" } {
  if (payments.length === 0) return { text: copy.paymentNone, tone: "none" };
  const succeeded = payments.find((p) => p.status === "succeeded");
  if (succeeded) return { text: copy.paymentSucceeded, tone: "ok" };
  const failed = payments.find((p) => p.status === "failed");
  if (failed) return { text: copy.paymentFailed, tone: "fail" };
  return { text: copy.paymentPending, tone: "warn" };
}

function agreementLabel(
  agreements: AgreementRow[],
  copy: ReturnType<typeof t>["dashboard"],
): { text: string; tone: "ok" | "warn" | "fail" | "none" } {
  if (agreements.length === 0) return { text: copy.agreementNone, tone: "none" };
  if (agreements.some((a) => a.status === "signed" || a.status === "completed"))
    return { text: copy.agreementSigned, tone: "ok" };
  if (agreements.some((a) => a.status === "declined" || a.status === "voided"))
    return { text: copy.agreementDeclined, tone: "fail" };
  return { text: copy.agreementPending, tone: "warn" };
}

function tourLabel(
  tours: TourJobRow[],
  copy: ReturnType<typeof t>["dashboard"],
): { text: string; tone: "ok" | "warn" | "fail" | "none" } | null {
  if (tours.length === 0) return null;
  if (tours.some((t) => t.status === "ready")) return { text: copy.tourReady, tone: "ok" };
  if (tours.some((t) => t.status === "processing"))
    return { text: copy.tourProcessing, tone: "warn" };
  if (tours.some((t) => t.status === "queued"))
    return { text: copy.tourQueued, tone: "warn" };
  if (tours.some((t) => t.status === "failed" || t.status === "expired"))
    return { text: copy.tourFailed, tone: "fail" };
  return null;
}

function statusLabel(
  mlsStatus: string,
  copy: ReturnType<typeof t>["dashboard"],
): { text: string; tone: "ok" | "warn" | "draft" } {
  switch (mlsStatus) {
    case "active":
      return { text: copy.statusActive, tone: "ok" };
    case "pending_approval":
      return { text: copy.statusPendingApproval, tone: "warn" };
    case "sold":
      return { text: copy.statusSold, tone: "ok" };
    case "inactive":
      return { text: copy.statusInactive, tone: "draft" };
    default:
      return { text: copy.statusDraft, tone: "draft" };
  }
}

const TONE_CLASSES: Record<string, string> = {
  ok: "border-gold bg-gold/5 text-ink",
  warn: "border-gold-soft bg-ivory-strong/40 text-ink/80",
  fail: "border-red-300 bg-red-50 text-red-800",
  draft: "border-gold-soft bg-ivory-strong/30 text-ink/60",
  none: "border-gold-soft bg-ivory text-ink/55",
};

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireUser(lang as Locale, "/dashboard");

  const copy = t(lang).dashboard;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  // Listings owned by the user. RLS already gates by owner, but be explicit.
  const { data: listingRows } = await supabase
    .from("properties")
    .select(
      "id,address_street,address_city,address_state,address_zip,list_price,pricing_tier,mls_status,created_at",
    )
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  const listings = (listingRows ?? []) as ListingRow[];
  const ids = listings.map((l) => l.id);

  // Fetch everything else in parallel and group by property_id client-side.
  const [{ data: photoRows }, { data: payRows }, { data: agRows }, { data: tourRows }] =
    await Promise.all([
      ids.length > 0
        ? supabase
            .from("property_photos")
            .select("property_id,url,is_primary,display_order")
            .in("property_id", ids)
            .order("display_order", { ascending: true })
        : Promise.resolve({ data: [] as PhotoRow[] }),
      ids.length > 0
        ? supabase
            .from("payments")
            .select("property_id,status,created_at")
            .in("property_id", ids)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as PaymentRow[] }),
      ids.length > 0
        ? supabase
            .from("agreements")
            .select("property_id,status")
            .in("property_id", ids)
        : Promise.resolve({ data: [] as AgreementRow[] }),
      ids.length > 0
        ? supabase
            .from("tour_jobs")
            .select("property_id,status")
            .in("property_id", ids)
        : Promise.resolve({ data: [] as TourJobRow[] }),
    ]);

  const photoByProperty = new Map<string, string>();
  for (const ph of (photoRows ?? []) as PhotoRow[]) {
    if (ph.is_primary) photoByProperty.set(ph.property_id, ph.url);
    else if (!photoByProperty.has(ph.property_id))
      photoByProperty.set(ph.property_id, ph.url);
  }
  const paymentsByProperty = new Map<string, PaymentRow[]>();
  for (const p of (payRows ?? []) as PaymentRow[]) {
    const arr = paymentsByProperty.get(p.property_id) ?? [];
    arr.push(p);
    paymentsByProperty.set(p.property_id, arr);
  }
  const agreementsByProperty = new Map<string, AgreementRow[]>();
  for (const a of (agRows ?? []) as AgreementRow[]) {
    const arr = agreementsByProperty.get(a.property_id) ?? [];
    arr.push(a);
    agreementsByProperty.set(a.property_id, arr);
  }
  const toursByProperty = new Map<string, TourJobRow[]>();
  for (const t of (tourRows ?? []) as TourJobRow[]) {
    const arr = toursByProperty.get(t.property_id) ?? [];
    arr.push(t);
    toursByProperty.set(t.property_id, arr);
  }

  // Buyer side: offers I've made + saved properties.
  const [{ data: myOffers }, { data: savedRows }] = await Promise.all([
    supabase
      .from("offers")
      .select("id,property_id,offer_amount,status,created_at")
      .eq("buyer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("saved_properties")
      .select("property_id,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const offers = (myOffers ?? []) as Array<{
    id: string;
    property_id: string;
    offer_amount: number;
    status: string;
    created_at: string;
  }>;
  const savedIds = ((savedRows ?? []) as Array<{ property_id: string }>).map(
    (s) => s.property_id,
  );
  const relatedPropertyIds = Array.from(
    new Set([...offers.map((o) => o.property_id), ...savedIds]),
  );
  const propertyById = new Map<
    string,
    { address_street: string; address_city: string; address_state: string; list_price: number }
  >();
  if (relatedPropertyIds.length > 0) {
    const { data: rows } = await supabase
      .from("properties")
      .select("id,address_street,address_city,address_state,list_price")
      .in("id", relatedPropertyIds);
    for (const r of (rows ?? []) as Array<{
      id: string;
      address_street: string;
      address_city: string;
      address_state: string;
      list_price: number;
    }>) {
      propertyById.set(r.id, r);
    }
  }
  const savedPhotoMap = new Map<string, string>();
  if (savedIds.length > 0) {
    const { data: photos } = await supabase
      .from("property_photos")
      .select("property_id,url,is_primary,display_order")
      .in("property_id", savedIds)
      .order("display_order", { ascending: true });
    for (const ph of (photos ?? []) as PhotoRow[]) {
      if (ph.is_primary) savedPhotoMap.set(ph.property_id, ph.url);
      else if (!savedPhotoMap.has(ph.property_id))
        savedPhotoMap.set(ph.property_id, ph.url);
    }
  }
  const buyerCopy = t(lang).dashboardBuyer;
  const hasBuyerActivity = offers.length > 0 || savedIds.length > 0;

  return (
    <main className="bg-background text-foreground flex-1 flex flex-col">
      <section className="mx-auto w-full max-w-7xl px-6 lg:px-12 pt-12 pb-20 lg:pt-16 lg:pb-28">
        <div className="flex flex-col gap-3 mb-12 lg:mb-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
            {copy.eyebrow}
          </p>
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <h1 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-3xl">
              {copy.titleBefore}
              <em className="italic text-gold">{copy.titleAccent}</em>
              {copy.titleAfter}
            </h1>
            {listings.length > 0 && (
              <Link
                href={`/${lang}/listing/new`}
                className="inline-flex items-center px-8 py-4 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
              >
                + {copy.ctaNew}
              </Link>
            )}
          </div>
          <p className="text-base leading-relaxed text-ink/70 max-w-2xl">
            {copy.body}
          </p>
        </div>

        {listings.length === 0 ? (
          <div className="border border-gold-soft bg-ivory-strong/40 p-10 lg:p-14 flex flex-col items-start gap-5 max-w-2xl">
            <h2 className="font-display text-2xl text-ink font-normal">
              {copy.emptyTitle}
            </h2>
            <p className="text-base text-ink/70 leading-relaxed">
              {copy.emptyBody}
            </p>
            <Link
              href={`/${lang}/listing/new`}
              className="inline-flex items-center px-8 py-4 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
            >
              {copy.ctaPrimary}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {listings.map((l) => {
              const photo = photoByProperty.get(l.id);
              const status = statusLabel(l.mls_status, copy);
              const payment = paymentLabel(
                paymentsByProperty.get(l.id) ?? [],
                copy,
              );
              const agreement = agreementLabel(
                agreementsByProperty.get(l.id) ?? [],
                copy,
              );
              const tour = tourLabel(toursByProperty.get(l.id) ?? [], copy);
              const tierId = (l.pricing_tier ?? "") as PricingTierId | "";
              const tier = tierId && tierId in PRICING_TIERS
                ? PRICING_TIERS[tierId as PricingTierId]
                : null;
              const isDraft = l.mls_status === "draft";

              return (
                <div
                  key={l.id}
                  className="flex flex-col gap-4 border border-gold-soft bg-ivory overflow-hidden"
                >
                  <div className="aspect-[16/10] bg-ivory-strong relative">
                    {photo ? (
                      <Image
                        src={photo}
                        alt={l.address_street}
                        fill
                        sizes="(min-width: 1024px) 400px, 100vw"
                        className="object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-[0.22em] text-ink/40">
                        {copy.noPhotos}
                      </div>
                    )}
                    <div className="absolute top-3 left-3">
                      <span
                        className={`inline-block text-[10px] font-semibold uppercase tracking-[0.18em] px-3 py-1.5 border ${TONE_CLASSES[status.tone]}`}
                      >
                        {status.text}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 px-5 pb-5">
                    <div className="flex flex-col gap-1">
                      <h3 className="font-display text-lg text-ink leading-tight">
                        {l.address_street}
                      </h3>
                      <p className="text-xs text-ink/55">
                        {l.address_city}, {l.address_state} {l.address_zip}
                      </p>
                    </div>

                    <div className="flex items-baseline justify-between gap-3 border-t border-gold-soft pt-3">
                      <span className="font-display italic text-xl text-ink">
                        <span className="text-gold text-sm align-top">$</span>
                        {l.list_price.toLocaleString()}
                      </span>
                      {tier && (
                        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                          {copy.tierLabel}: {tierId.charAt(0).toUpperCase() + tierId.slice(1)} · {formatPrice(tier.flatFee)} + {tier.commissionPct}%
                        </span>
                      )}
                    </div>

                    <ul className="flex flex-wrap gap-1.5 border-t border-gold-soft pt-3">
                      <li>
                        <span
                          className={`inline-block text-[9px] uppercase tracking-[0.16em] px-2.5 py-1 border ${TONE_CLASSES[payment.tone]}`}
                        >
                          {payment.text}
                        </span>
                      </li>
                      <li>
                        <span
                          className={`inline-block text-[9px] uppercase tracking-[0.16em] px-2.5 py-1 border ${TONE_CLASSES[agreement.tone]}`}
                        >
                          {agreement.text}
                        </span>
                      </li>
                      {tour && (
                        <li>
                          <span
                            className={`inline-block text-[9px] uppercase tracking-[0.16em] px-2.5 py-1 border ${TONE_CLASSES[tour.tone]}`}
                          >
                            {tour.text}
                          </span>
                        </li>
                      )}
                    </ul>

                    <div className="flex flex-col gap-2 pt-2">
                      {isDraft ? (
                        <Link
                          href={`/${lang}/listing/new?id=${l.id}&step=6`}
                          className="text-[10px] uppercase tracking-[0.22em] text-gold hover:text-ink transition-colors"
                        >
                          {copy.continueListingButton}
                        </Link>
                      ) : (
                        <Link
                          href={`/${lang}/property/${l.id}`}
                          className="text-[10px] uppercase tracking-[0.22em] text-gold hover:text-ink transition-colors"
                        >
                          {copy.viewListingButton}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Buyer-side sections — only render if the user has activity here. */}
        {hasBuyerActivity && (
          <div className="mt-16 lg:mt-24 flex flex-col gap-12">
            {offers.length > 0 && (
              <div>
                <h2 className="font-display text-2xl text-ink mb-6 border-b border-gold-soft pb-3">
                  {buyerCopy.offersHeader}
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-ink/55 border-b border-gold-soft">
                        <th className="py-3 pr-4">{buyerCopy.offerSubmitted}</th>
                        <th className="py-3 pr-4">{buyerCopy.offerProperty}</th>
                        <th className="py-3 pr-4">{buyerCopy.offerAmount}</th>
                        <th className="py-3 pr-4">{buyerCopy.offerStatus}</th>
                        <th className="py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {offers.map((o) => {
                        const prop = propertyById.get(o.property_id);
                        return (
                          <tr key={o.id} className="border-b border-gold-soft/50">
                            <td className="py-3 pr-4 text-ink/70 text-xs whitespace-nowrap">
                              {new Date(o.created_at).toLocaleDateString(lang, {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })}
                            </td>
                            <td className="py-3 pr-4 text-ink text-xs">
                              {prop
                                ? `${prop.address_street}, ${prop.address_city}, ${prop.address_state}`
                                : o.property_id.slice(0, 8)}
                            </td>
                            <td className="py-3 pr-4 font-display text-base text-ink whitespace-nowrap">
                              <span className="text-gold text-xs align-top">$</span>
                              {o.offer_amount.toLocaleString()}
                            </td>
                            <td className="py-3 pr-4">
                              <span
                                className={`inline-block text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border ${
                                  o.status === "accepted"
                                    ? "border-gold bg-gold/5 text-ink"
                                    : o.status === "rejected" || o.status === "withdrawn" || o.status === "expired"
                                      ? "border-red-300 bg-red-50 text-red-800"
                                      : "border-gold-soft bg-ivory-strong/40 text-ink/70"
                                }`}
                              >
                                {o.status}
                              </span>
                            </td>
                            <td className="py-3 text-xs">
                              <Link
                                href={`/${lang}/property/${o.property_id}`}
                                className="text-gold hover:text-ink transition-colors"
                              >
                                {buyerCopy.viewProperty}
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {savedIds.length > 0 && (
              <div>
                <h2 className="font-display text-2xl text-ink mb-6 border-b border-gold-soft pb-3">
                  {buyerCopy.savedHeader}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
                  {savedIds.map((pid) => {
                    const prop = propertyById.get(pid);
                    const photo = savedPhotoMap.get(pid);
                    if (!prop) return null;
                    return (
                      <Link
                        key={pid}
                        href={`/${lang}/property/${pid}`}
                        className="flex flex-col gap-3 border border-gold-soft bg-ivory overflow-hidden hover:border-gold transition-colors"
                      >
                        <div className="aspect-[16/10] bg-ivory-strong relative">
                          {photo ? (
                            <Image
                              src={photo}
                              alt={prop.address_street}
                              fill
                              sizes="(min-width: 1024px) 400px, 100vw"
                              className="object-cover"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-[0.22em] text-ink/40">
                              —
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-1 px-4 pb-4">
                          <p className="font-display text-base text-ink leading-tight">
                            {prop.address_street}
                          </p>
                          <p className="text-xs text-ink/55">
                            {prop.address_city}, {prop.address_state}
                          </p>
                          <p className="font-display italic text-lg text-ink mt-1">
                            <span className="text-gold text-sm align-top">$</span>
                            {prop.list_price.toLocaleString()}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
