import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { BROKERAGE, brokerageLicenseLine, fillBrokerageCopy } from "@/config/brokerage";
import { BrokerageFacts } from "@/components/brokerage-facts";
import { BROKER_PROFILE, TEAM_MEMBERS, initials } from "@/config/team";
import { buyerContactHref } from "@/lib/buyer-entry";
import { ListingCtaLink } from "@/components/listing-cta-link";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const copy = t(isLocale(lang) ? lang : "en").aboutPage;
  return { title: `${copy.metaTitle} | Lixtara`, description: fillBrokerageCopy(copy.intro) };
}

// Presenta la correduría, la broker y su equipo. Licencias, nombre y dirección salen de
// src/config/brokerage.ts; teléfono y WhatsApp, de src/config/contact.ts; fotos y bios, de
// src/config/team.ts (vacías hasta que lleguen: sin fotos genéricas).
export default async function AboutPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const copy = t(lang).aboutPage;

  const people = [
    {
      name: BROKERAGE.brokerName,
      role: `${copy.brokerRole} · ${copy.licenseLabel} #${BROKERAGE.brokerLicense}`,
      photo: BROKER_PROFILE.photo,
      bio: BROKER_PROFILE.bio?.[lang] ?? null,
    },
    ...TEAM_MEMBERS.map((m) => ({ name: m.name, role: m.role[lang], photo: m.photo, bio: m.bio?.[lang] ?? null })),
  ];

  return (
    <main className="bg-background text-foreground flex-1">
      <section className="mx-auto w-full max-w-5xl px-6 lg:px-12 py-20 lg:py-28 flex flex-col gap-16">
        <div className="flex flex-col gap-8 max-w-3xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">{copy.eyebrow}</p>
          <h1 className="font-display text-5xl md:text-6xl leading-[1.05] tracking-tight text-ink font-normal">
            {copy.titleBefore}
            <em className="italic text-gold">{copy.titleAccent}</em>
            {copy.titleAfter}
          </h1>
          <p className="font-display text-2xl leading-snug text-ink">{fillBrokerageCopy(copy.intro)}</p>
          <p className="text-lg leading-relaxed text-ink/70">{copy.sellers}</p>
          <p className="text-lg leading-relaxed text-ink/70">{copy.buyers}</p>
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center pt-2">
            <ListingCtaLink
              href={`/${lang}/listing/new`}
              location="about"
              lang={lang}
              className="inline-flex items-center justify-center px-8 py-4 bg-ink text-ivory text-[11px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
            >
              {copy.ctaSell}
            </ListingCtaLink>
            <a
              href={buyerContactHref(lang)}
              className="inline-flex items-center justify-center px-8 py-4 border border-ink text-ink text-[11px] font-medium tracking-[0.2em] uppercase hover:border-gold hover:text-gold transition-colors"
            >
              {copy.ctaBuy}
            </a>
          </div>
        </div>

        <div className="border-t border-gold-soft pt-12 flex flex-col gap-8">
          <h2 className="font-display text-3xl text-ink font-normal">{copy.factsTitle}</h2>
          <BrokerageFacts lang={lang} />
        </div>

        <div className="border-t border-gold-soft pt-12 flex flex-col gap-8">
          <h2 className="font-display text-3xl text-ink font-normal">{copy.teamTitle}</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {people.map((p) => (
              <li key={p.name} className="flex flex-col gap-4 border border-gold-soft bg-ivory p-6">
                <div className="relative w-full aspect-[4/5] bg-ivory-strong/40 flex items-center justify-center">
                  {p.photo ? (
                    <Image src={p.photo} alt={p.name} fill sizes="(min-width: 1024px) 300px, 90vw" className="object-cover" />
                  ) : (
                    <span aria-hidden className="font-display italic text-5xl text-gold">
                      {initials(p.name)}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <p className="font-display text-xl text-ink">{p.name}</p>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55 leading-relaxed">{p.role}</p>
                </div>
                {p.bio && <p className="text-sm leading-relaxed text-ink/70">{p.bio}</p>}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55 leading-relaxed">{brokerageLicenseLine(lang)}</p>
      </section>
    </main>
  );
}
