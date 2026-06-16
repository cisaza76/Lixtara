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
import { createClient } from "@/lib/supabase/server";
import { TourComingSoon } from "@/components/tour-coming-soon";
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
  const mapUrl =
    property.latitude && property.longitude
      ? mapboxStaticUrl(property.latitude, property.longitude, 600, 400)
      : null;

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
          <div className="relative aspect-[16/10] lg:aspect-[2/1] overflow-hidden bg-ivory-strong mb-12 lg:mb-16">
            <Image
              src={property.primary_photo_url}
              alt={street}
              fill
              priority
              sizes="(min-width: 1024px) 1200px, 100vw"
              className="object-cover"
            />
            {isDemoListing(property.address_street) && (
              <div className="absolute top-4 left-4 bg-ivory text-ink text-[10px] font-semibold tracking-[0.22em] uppercase px-3 py-1.5">
                {copy.demoBadge}
              </div>
            )}
          </div>
        )}

        <div className="mb-12 lg:mb-16">
          <TourComingSoon
            eyebrow={copy.tourEyebrow}
            title={copy.tourSoonTitle}
            body={copy.tourSoonBody}
            badge={copy.tourSoonBadge}
          />
        </div>

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
                  className="relative aspect-[4/3] overflow-hidden bg-ivory-strong border border-gold-soft"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ph.url}
                    alt={`${street} — photo ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  {ph.is_staged && (
                    <div className="absolute top-2 right-2 bg-ink/85 text-ivory text-[9px] font-semibold tracking-[0.2em] uppercase px-2 py-1">
                      ✨ {copy.stagedBadge}
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

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
          {/* LEFT: details */}
          <div className="lg:col-span-7 flex flex-col gap-10">
            <div className="flex flex-col gap-4">
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
              <div className="flex flex-col gap-1.5">
                <dt className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                  {copy.bedsLabel}
                </dt>
                <dd className="font-display text-2xl text-ink leading-none">
                  {property.bedrooms}
                </dd>
              </div>
              <div className="flex flex-col gap-1.5">
                <dt className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                  {copy.bathsLabel}
                </dt>
                <dd className="font-display text-2xl text-ink leading-none">
                  {property.bathrooms}
                </dd>
              </div>
              <div className="flex flex-col gap-1.5">
                <dt className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                  {copy.sqftLabel}
                </dt>
                <dd className="font-display text-2xl text-ink leading-none">
                  {property.sqft.toLocaleString()}
                </dd>
              </div>
              <div className="flex flex-col gap-1.5">
                <dt className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                  {copy.yearBuiltLabel}
                </dt>
                <dd className="font-display text-2xl text-ink leading-none">
                  {property.year_built}
                </dd>
              </div>
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
            <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55 leading-relaxed text-center">
              {BROKERAGE_NAME} ·{" "}
              {copy.buyerCommissionLabel}: {property.buyer_agent_commission}%
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
