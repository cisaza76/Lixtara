import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import {
  getPropertyById,
  formatPropertyPrice,
  mapboxStaticUrl,
  isDemoListing,
  cleanDemoPrefix,
} from "@/lib/properties";
import { BROKERAGE_NAME, BROKERAGE_LICENSED_ENTITY } from "@/lib/broker";
import { validateUsAddress } from "@/lib/geocode";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { TourComingSoon } from "@/components/tour-coming-soon";
import { StagingShowcase } from "@/components/staging-showcase";
import { LivingListingShowcase } from "@/components/living-listing-showcase";
import { OfferForm } from "@/components/offer-form";
import { SaveButton } from "@/components/save-button";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();

  const copy = t(lang).property;
  const property = await getPropertyById(id);

  if (!property) {
    return (
      <main className="bg-background text-foreground flex-1 flex items-center justify-center px-6 py-32">
        <div className="max-w-md text-center flex flex-col items-center gap-6">
          <h1 className="font-display text-4xl text-ink font-normal">
            {copy.notFoundTitle}
          </h1>
          <p className="text-base text-ink/70">{copy.notFoundBody}</p>
          <Link
            href={`/${lang}/properties`}
            className="text-[10px] uppercase tracking-[0.22em] text-gold"
          >
            {copy.backToListings}
          </Link>
        </div>
      </main>
    );
  }

  const street = cleanDemoPrefix(property.address_street);
  const fullAddress = `${street}, ${property.address_city}, ${property.address_state} ${property.address_zip}`;

  // Resolves current user + owner_id + saved state for the offer form
  // and save button.
  let signedIn = false;
  let isOwner = false;
  let initiallySaved = false;
  {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = !!user;
    if (user) {
      const { data: ownerRow } = await supabase
        .from("properties")
        .select("owner_id")
        .eq("id", property.id)
        .maybeSingle();
      isOwner = ownerRow?.owner_id === user.id;

      const { data: savedRow } = await supabase
        .from("saved_properties")
        .select("id")
        .eq("user_id", user.id)
        .eq("property_id", property.id)
        .maybeSingle();
      initiallySaved = !!savedRow;
    }
  }
  const offerCopy = t(lang).offer;
  const saveCopy = t(lang).save;
  // Map coords: prefer the stored lat/lng; if missing (geocode never ran when
  // the listing was saved), best-effort geocode at render so the Location map
  // still shows instead of "unavailable".
  let mapLat = property.latitude;
  let mapLng = property.longitude;
  if (mapLat == null || mapLng == null) {
    const geo = await validateUsAddress(
      street,
      property.address_city,
      property.address_state,
      property.address_zip,
    );
    mapLat = geo.lat ?? null;
    mapLng = geo.lng ?? null;
  }
  const mapUrl =
    mapLat != null && mapLng != null
      ? mapboxStaticUrl(mapLat, mapLng, 600, 400)
      : null;

  // "Living Listing" clips: ready AI-motion videos for this property. The
  // tour-videos bucket is private and tour_jobs RLS is owner-only, so a public
  // viewer can't read them through the normal client — use the service client
  // (read-only here) to list ready video jobs and sign short-lived playback URLs.
  const livingVideos: { url: string; poster: string | null }[] = [];
  {
    const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const svcKey = process.env.SUPABASE_SECRET_KEY;
    if (svcUrl && svcKey) {
      const svc = createServiceClient(svcUrl, svcKey, {
        auth: { persistSession: false },
      });
      const { data: jobs } = await svc
        .from("tour_jobs")
        .select("output_path, completed_at")
        .eq("property_id", property.id)
        .eq("tour_kind", "video")
        .eq("status", "ready")
        .not("output_path", "is", null)
        .order("completed_at", { ascending: false });
      const poster = property.photos[0]?.url ?? null;
      for (const job of jobs ?? []) {
        const path = job.output_path as string | null;
        if (!path) continue;
        const { data: signed } = await svc.storage
          .from("tour-videos")
          .createSignedUrl(path, 60 * 60);
        if (signed?.signedUrl) {
          livingVideos.push({ url: signed.signedUrl, poster });
        }
      }
    }
  }

  // JSON-LD RealEstateListing schema for SEO.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: street,
    description: property.description ?? undefined,
    image: property.photos.map((ph) => ph.url),
    url: `https://lixtara.vercel.app/${lang}/property/${property.id}`,
    address: {
      "@type": "PostalAddress",
      streetAddress: street,
      addressLocality: property.address_city,
      addressRegion: property.address_state,
      postalCode: property.address_zip,
      addressCountry: "US",
    },
    geo:
      property.latitude && property.longitude
        ? {
            "@type": "GeoCoordinates",
            latitude: property.latitude,
            longitude: property.longitude,
          }
        : undefined,
    offers: {
      "@type": "Offer",
      price: property.list_price,
      priceCurrency: "USD",
    },
    numberOfRooms: property.bedrooms,
    numberOfBathroomsTotal: property.bathrooms,
    floorSize: {
      "@type": "QuantitativeValue",
      value: property.sqft,
      unitCode: "FTK",
    },
    yearBuilt: property.year_built,
    broker: {
      "@type": "RealEstateAgent",
      name: BROKERAGE_LICENSED_ENTITY,
    },
  };

  return (
    <main className="bg-background text-foreground flex-1 flex flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="mx-auto w-full max-w-7xl px-6 lg:px-12 pt-8 lg:pt-10">
        <Link
          href={`/${lang}/properties`}
          className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
        >
          ← {copy.backToListings}
        </Link>
      </div>

      <section className="mx-auto w-full max-w-7xl px-6 lg:px-12 pt-8 pb-16 lg:pb-24">
        {property.primary_photo_url && (
          <div className="group relative aspect-[16/10] lg:aspect-[2/1] overflow-hidden bg-ivory-strong mb-12 lg:mb-16">
            <Image
              src={property.primary_photo_url}
              alt={street}
              fill
              priority
              sizes="(min-width: 1024px) 1200px, 100vw"
              className="object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.03]"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/45 via-transparent to-transparent" />
            {isDemoListing(property.address_street) && (
              <div className="absolute top-4 left-4 bg-ivory text-ink text-[10px] font-semibold tracking-[0.22em] uppercase px-3 py-1.5">
                {copy.demoBadge}
              </div>
            )}
            <span className="absolute bottom-5 left-5 lg:bottom-7 lg:left-8 text-[10px] font-semibold uppercase tracking-[0.22em] text-ivory/85">
              {copy.forSale}
            </span>
          </div>
        )}

        {/* Public photo gallery. Staged photos carry a permanent on-image
            badge + the disclaimer footer renders below for MLS compliance
            (Stellar + Miami Realtors require visible labeling of virtually
            staged imagery). */}
        {property.photos.length > 1 && (
          <div className="mb-12 lg:mb-16">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {property.photos.map((ph, i) => (
                <div
                  key={ph.url}
                  className="group/photo relative aspect-[4/3] overflow-hidden border border-gold-soft bg-ivory-strong transition-colors duration-300 hover:border-gold/60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ph.url}
                    alt={`${street} — photo ${i + 1}`}
                    className="h-full w-full object-cover transition-transform duration-[600ms] ease-out group-hover/photo:scale-[1.05]"
                  />
                  {ph.is_staged && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 bg-ink/85 text-ivory text-[9px] font-semibold tracking-[0.2em] uppercase px-2 py-1">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 2l1.9 5.6L19.5 9l-4.6 1.4L12 16l-2.9-5.6L4.5 9l5.6-1.4z" />
                      </svg>
                      {copy.stagedBadge}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {property.photos.some((p) => p.is_staged) && (
              <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-ink/55 italic">
                {copy.stagedDisclaimer}
              </p>
            )}
          </div>
        )}

        <StagingShowcase
          copy={{
            eyebrow: copy.stagingEyebrow,
            title: copy.stagingTitle,
            body: copy.stagingBody,
            beforeLabel: copy.stagingBefore,
            afterLabel: copy.stagingAfter,
            handleLabel: copy.stagingHandle,
            styleMinimalist: copy.stagingStyleMinimalist,
            styleModern: copy.stagingStyleModern,
            disclaimer: copy.stagingShowcaseDisclaimer,
          }}
        />

        <LivingListingShowcase
          videos={livingVideos}
          copy={{
            eyebrow: copy.livingEyebrow,
            title: copy.livingTitle,
            body: copy.livingBody,
            badge: copy.livingBadge,
            disclaimer: copy.livingDisclaimer,
          }}
        />

        <div className="mb-12 lg:mb-16">
          <TourComingSoon
            eyebrow={copy.tourEyebrow}
            title={copy.tourSoonTitle}
            body={copy.tourSoonBody}
            badge={copy.tourSoonBadge}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
          {/* LEFT: details */}
          <div className="lg:col-span-7 flex flex-col gap-10">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                  {copy.forSale}
                </span>
                <span className="text-gold-soft">·</span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                  {(copy.propertyType as Record<string, string>)[
                    property.property_type
                  ] ?? copy.typeLabel}
                </span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <h1 className="font-display text-3xl md:text-4xl lg:text-5xl leading-tight text-ink font-normal">
                  {street}
                </h1>
                {!isOwner && (
                  <SaveButton
                    propertyId={property.id}
                    initiallySaved={initiallySaved}
                    signedIn={signedIn}
                    signInHref={`/${lang}/sign-in?next=/property/${property.id}`}
                    labels={{
                      saveButton: saveCopy.saveButton,
                      savedButton: saveCopy.savedButton,
                      saveFailed: saveCopy.saveFailed,
                      removeFailed: saveCopy.removeFailed,
                    }}
                  />
                )}
              </div>
              <p className="text-base text-ink/60">
                {property.address_city}, {property.address_state}{" "}
                {property.address_zip}
              </p>
              <div className="font-display italic text-4xl lg:text-5xl leading-none">
                <span className="text-gold text-2xl align-top">$</span>
                <span className="text-ink">
                  {property.list_price.toLocaleString()}
                </span>
              </div>
            </div>

            <dl className="grid grid-cols-2 md:grid-cols-4 gap-y-8 gap-x-6 border-t border-gold-soft pt-10">
              {[
                {
                  label: copy.bedsLabel,
                  value: String(property.bedrooms),
                  icon: (
                    <>
                      <path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6" />
                      <path d="M3 14h18" />
                      <path d="M7 10V8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
                      <path d="M13 10V8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
                      <path d="M4 18v2M20 18v2" />
                    </>
                  ),
                },
                {
                  label: copy.bathsLabel,
                  value: String(property.bathrooms),
                  icon: (
                    <>
                      <path d="M4 12V6a2 2 0 0 1 3.9-.6" />
                      <path d="M2 12h20v3a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" />
                      <path d="M7 19l-1 2M17 19l1 2" />
                    </>
                  ),
                },
                {
                  label: copy.sqftLabel,
                  value: property.sqft.toLocaleString(),
                  icon: (
                    <>
                      <path d="M3 8V5a2 2 0 0 1 2-2h3" />
                      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
                      <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
                      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
                    </>
                  ),
                },
                {
                  label: copy.yearBuiltLabel,
                  value: String(property.year_built),
                  icon: (
                    <>
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <path d="M3 10h18M8 2v4M16 2v4" />
                    </>
                  ),
                },
              ].map((s) => (
                <div key={s.label} className="flex flex-col gap-2.5">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="text-gold"
                  >
                    {s.icon}
                  </svg>
                  <dd className="font-display text-2xl text-ink leading-none">
                    {s.value}
                  </dd>
                  <dt className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                    {s.label}
                  </dt>
                </div>
              ))}
            </dl>

            {property.description && (
              <div className="border-t border-gold-soft pt-10 flex flex-col gap-4">
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                  {copy.descriptionLabel}
                </h2>
                <p className="text-base leading-relaxed text-ink/80 max-w-prose">
                  {property.description}
                </p>
              </div>
            )}
          </div>

          {/* RIGHT: location + CTA */}
          <div className="lg:col-span-5 flex flex-col gap-8">
            <div className="border border-gold-soft p-8 flex flex-col gap-6">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                {copy.locationLabel}
              </h2>
              {mapUrl ? (
                <div className="relative aspect-[3/2] overflow-hidden bg-ivory-strong">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mapUrl}
                    alt={`Map of ${fullAddress}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="aspect-[3/2] bg-ivory-strong flex items-center justify-center text-[10px] uppercase tracking-[0.18em] text-ink/40">
                  Location unavailable
                </div>
              )}
              <div className="flex flex-col gap-1 text-sm leading-relaxed text-ink">
                <div>{street}</div>
                <div className="text-ink/60">
                  {property.address_city}, {property.address_state}{" "}
                  {property.address_zip}
                </div>
              </div>
            </div>

            <OfferForm
              propertyId={property.id}
              lang={lang}
              listPrice={property.list_price}
              signedIn={signedIn}
              signInHref={`/${lang}/sign-in?next=/property/${property.id}`}
              isOwner={isOwner}
              labels={offerCopy}
            />
            <div className="flex flex-col gap-3 border-t border-gold-soft pt-5 text-[11px] leading-relaxed text-ink/75">
              {[
                {
                  text: `${BROKERAGE_NAME} — ${copy.trustLicensed}`,
                  icon: (
                    <path d="M12 22s7-3.5 7-9V5.5L12 3 5 5.5V13c0 5.5 7 9 7 9zM9 12l2 2 4-4" />
                  ),
                },
                {
                  text: copy.trustMls,
                  icon: <path d="M20 6 9 17l-5-5" />,
                },
                {
                  text: `${copy.buyerCommissionLabel}: ${property.buyer_agent_commission}%`,
                  icon: (
                    <>
                      <line x1="19" y1="5" x2="5" y2="19" />
                      <circle cx="6.5" cy="6.5" r="2.5" />
                      <circle cx="17.5" cy="17.5" r="2.5" />
                    </>
                  ),
                },
              ].map((item) => (
                <div key={item.text} className="flex items-center gap-2.5">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="shrink-0 text-gold"
                  >
                    {item.icon}
                  </svg>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
