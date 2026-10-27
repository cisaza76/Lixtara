import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { after } from "next/server";
import { notFound } from "next/navigation";
import { isLocale, t, type Locale } from "@/lib/i18n";
import { CONTACT_EMAIL, fillBrokerageCopy } from "@/config/brokerage";
import { termsFaq } from "@/config/legal-terms";
import { ListingCtaLink } from "@/components/listing-cta-link";
import { BrokerageFacts } from "@/components/brokerage-facts";
import {
  FaqList,
  HowItWorksSection,
  PricingSection,
  SavingsSection,
  SECTION_INNER,
  SECTION_TITLE_GAP,
} from "@/components/home-sections";
import { isHumanPageView } from "@/lib/funnel-events";
import { recordPageViewEvent } from "@/lib/funnel-events.server";
import { ownersContactHref } from "@/lib/owners-landing";

// Landing de propietarios: destino de los enlaces de los correos de Instantly
// (?utm_source=instantly&utm_medium=email&utm_campaign=…). Sin enlace en el menú y con
// noindex. La página es igual para todos: no lee ningún parámetro para personalizarla
// (ni nombre, ni dirección, ni owner_key). Los UTM los recoge el navegador solo con
// consentimiento (lx_ft y lx_page_view).

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const copy = t(isLocale(lang) ? lang : "en").ownersPage;
  return {
    title: `${copy.metaTitle} | Lixtara`,
    description: copy.metaDescription,
    robots: { index: false, follow: true },
  };
}

export default async function OwnersPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const copy = t(lang).ownersPage;

  // Conteo de visitas sin consentimiento: solo el idioma, después de responder.
  const h = await headers();
  if (isHumanPageView({ userAgent: h.get("user-agent"), purpose: h.get("sec-purpose") ?? h.get("purpose") })) {
    after(() => recordPageViewEvent("owners_landing_view", lang));
  }

  const legalFaq = termsFaq(lang);
  const faqItems = [
    ...copy.faq.map((item) => ({ q: item.q, a: <WithContactEmail text={item.a} /> })),
    legalFaq.total,
    legalFaq.refund,
  ];

  return (
    <main className="bg-background text-foreground flex-1 flex flex-col">
      <section className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-32">
        <div className="flex flex-col gap-10 max-w-3xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">{copy.eyebrow}</p>
          <h1 className="font-display text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-tight text-ink font-normal">
            {copy.titleBefore}
            <em className="not-italic text-gold">{copy.titleAccent}</em>
            {copy.titleAfter}
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-ink/70">{fillBrokerageCopy(copy.intro)}</p>
          <OwnersCtas lang={lang} location="owners_hero" />
        </div>
      </section>

      <section className="border-t border-gold-soft">
        <div className={`${SECTION_INNER} flex flex-col gap-8`}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">{copy.whoEyebrow}</p>
          <h2 className="font-display text-3xl md:text-4xl leading-[1.1] tracking-tight text-ink font-normal max-w-3xl">
            {fillBrokerageCopy(copy.whoTitle)}
          </h2>
          <p className="max-w-2xl text-base leading-relaxed text-ink/70">{fillBrokerageCopy(copy.whoBody)}</p>
          <BrokerageFacts lang={lang} />
        </div>
      </section>

      <SavingsSection lang={lang} />
      <HowItWorksSection lang={lang} />
      <PricingSection lang={lang} />

      <section id="faq" className="border-t border-gold-soft scroll-mt-20">
        <div className={SECTION_INNER}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">{copy.faqEyebrow}</p>
          <h2 className={`font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl ${SECTION_TITLE_GAP}`}>
            {copy.faqTitle}
          </h2>
          <FaqList items={faqItems} />
        </div>
      </section>

      <section className="border-t border-gold-soft bg-ivory-strong/30">
        <div className={`${SECTION_INNER} flex flex-col gap-10`}>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl">
            {copy.finalTitle}
          </h2>
          <OwnersCtas lang={lang} location="owners_footer" />
        </div>
      </section>
    </main>
  );
}

function OwnersCtas({ lang, location }: { lang: Locale; location: "owners_hero" | "owners_footer" }) {
  const copy = t(lang).ownersPage;
  return (
    <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 sm:items-center">
      <ListingCtaLink
        href={`/${lang}/listing/new`}
        location={location}
        lang={lang}
        className="inline-flex items-center justify-center text-center px-10 py-5 bg-ink text-ivory text-xs font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
      >
        {copy.ctaListing}
      </ListingCtaLink>
      <Link
        href={ownersContactHref(lang)}
        className="inline-flex items-center justify-center text-center px-10 py-5 border border-ink text-ink text-xs font-medium tracking-[0.2em] uppercase hover:border-gold hover:text-gold transition-colors"
      >
        {copy.ctaTalk}
      </Link>
    </div>
  );
}

/** Respuesta con {contactEmail} como enlace mailto (CONTACT_EMAIL). */
function WithContactEmail({ text }: { text: string }) {
  const [before, after] = text.split("{contactEmail}");
  if (after === undefined) return <>{text}</>;
  return (
    <>
      {before}
      <a href={`mailto:${CONTACT_EMAIL}`} className="underline decoration-gold-soft underline-offset-4 hover:text-gold">
        {CONTACT_EMAIL}
      </a>
      {after}
    </>
  );
}
