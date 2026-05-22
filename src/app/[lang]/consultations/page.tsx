import { notFound } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import {
  ATTORNEY_HOURLY,
  REALTOR_HOURLY,
  REALTOR_TIERS,
  BEST_VALUE,
  bestValueTotals,
  type ConsultationProduct,
} from "@/lib/consultations";
import { ConsultationCheckoutButton } from "@/components/consultation-checkout-button";

export default async function ConsultationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ purchased?: string; error?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { purchased, error } = await searchParams;
  const copy = t(lang).consultations;
  const { totalValue, save, savePct } = bestValueTotals();
  const usd = (n: number) => `$${n.toLocaleString()}`;
  const btnLabels = { redirecting: copy.redirecting, failed: copy.failed };

  return (
    <main className="bg-background text-foreground flex-1">
      <section className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-28 flex flex-col gap-12">
        <div className="flex flex-col gap-3 max-w-2xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
            {copy.eyebrow}
          </p>
          <h1 className="font-display text-4xl md:text-5xl leading-[1.1] tracking-tight text-ink font-normal">
            {copy.title}
          </h1>
          <p className="text-lg leading-relaxed text-ink/70">{copy.body}</p>
        </div>

        {purchased && (
          <div className="border-2 border-gold bg-gold/5 p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              {copy.purchasedTitle}
            </p>
            <p className="text-sm text-ink mt-1">{copy.purchasedBody}</p>
          </div>
        )}
        {error === "cancelled" && (
          <div className="border border-gold-soft bg-ink/5 p-6">
            <p className="text-sm text-ink/70">{copy.cancelledNotice}</p>
          </div>
        )}

        {/* Best Value package */}
        <div className="border-2 border-gold bg-gold/5 p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              {copy.bestValueEyebrow}
            </p>
            <h2 className="font-display text-3xl text-ink">
              {copy.bestValueTitle} — {usd(BEST_VALUE.price)}
            </h2>
            <p className="text-sm text-ink/70">
              {copy.bestValueDesc
                .replace("{realtor}", String(BEST_VALUE.realtorHours))
                .replace("{attorney}", String(BEST_VALUE.attorneyHours))}
            </p>
            <p className="text-sm text-ink">
              {copy.totalValue}: <strong>{usd(totalValue)}</strong> ·{" "}
              <span className="text-gold font-semibold">
                {copy.youSave} {usd(save)} ({savePct}% {copy.off})
              </span>
            </p>
          </div>
          <ConsultationCheckoutButton
            product="best_value"
            lang={lang}
            label={copy.ctaBuy}
            variant="primary"
            className="self-start lg:self-center"
            labels={btnLabels}
          />
        </div>

        {/* Per-service */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Realtor */}
          <div className="border border-gold-soft p-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="font-display text-2xl text-ink">
                {copy.realtorTitle}
              </h3>
              <p className="text-sm text-ink/70">
                {usd(REALTOR_HOURLY)} {copy.perHour}
              </p>
            </div>
            <ul className="flex flex-col gap-2">
              {REALTOR_TIERS.map((tier) => (
                <li
                  key={tier.hours}
                  className="flex items-center justify-between border-t border-gold-soft pt-2 text-sm"
                >
                  <span className="text-ink">
                    {tier.hours} {tier.hours === 1 ? copy.hour : copy.hours}
                  </span>
                  <span className="flex items-center gap-3">
                    {tier.savePct > 0 && (
                      <span className="text-[9px] uppercase tracking-[0.18em] text-gold border border-gold px-2 py-0.5">
                        {copy.save} {tier.savePct}%
                      </span>
                    )}
                    <span className="font-display text-ink">
                      {usd(tier.price)}
                    </span>
                    <ConsultationCheckoutButton
                      product={`realtor_${tier.hours}` as ConsultationProduct}
                      lang={lang}
                      label={copy.buy}
                      variant="secondary"
                      labels={btnLabels}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Attorney */}
          <div className="border border-gold-soft p-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="font-display text-2xl text-ink">
                {copy.attorneyTitle}
              </h3>
              <p className="text-sm text-ink/70">
                {usd(ATTORNEY_HOURLY)} {copy.perHour}
              </p>
            </div>
            <p className="text-sm text-ink/70 leading-relaxed">
              {copy.attorneyDesc}
            </p>
            <ConsultationCheckoutButton
              product="attorney_1"
              lang={lang}
              label={copy.ctaBuy}
              variant="secondary"
              className="self-start"
              labels={btnLabels}
            />
          </div>
        </div>

        <p className="text-xs text-ink/55 italic border-t border-gold-soft pt-4">
          {copy.validityNote}
        </p>
      </section>
    </main>
  );
}
