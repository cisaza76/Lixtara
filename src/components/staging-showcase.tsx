// "AI Virtual Staging" showcase band — the flagship visual. Renders curated
// real before/after pairs (Lixtara-generated via Luma Uni-1) in an interactive
// comparison slider. Static assets in /public/staging-showcase keep it zero-risk
// and instant (no DB / no runtime generation on the listing page).

import { BeforeAfterSlider } from "@/components/before-after-slider";

export interface StagingShowcaseCopy {
  eyebrow: string;
  title: string;
  body: string;
  beforeLabel: string;
  afterLabel: string;
  handleLabel: string;
  styleMinimalist: string;
  styleModern: string;
  disclaimer: string;
}

const PAIRS = [
  { key: "a", styleKey: "styleMinimalist" as const },
  { key: "b", styleKey: "styleModern" as const },
];

export function StagingShowcase({ copy }: { copy: StagingShowcaseCopy }) {
  return (
    <section className="mb-12 border border-gold-soft bg-ivory-strong/30 p-6 lg:mb-16 lg:p-10">
      <div className="mb-7 flex flex-col gap-3 lg:mb-9">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
          {copy.eyebrow}
        </p>
        <h2 className="max-w-2xl font-display text-2xl leading-tight text-ink lg:text-3xl">
          {copy.title}
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-ink/70">
          {copy.body}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
        {PAIRS.map((p) => (
          <figure key={p.key} className="flex flex-col gap-3">
            <BeforeAfterSlider
              beforeSrc={`/staging-showcase/${p.key}-before.jpg`}
              afterSrc={`/staging-showcase/${p.key}-after.jpg`}
              beforeAlt={copy.beforeLabel}
              afterAlt={`${copy.afterLabel} — ${copy[p.styleKey]}`}
              beforeLabel={copy.beforeLabel}
              afterLabel={copy.afterLabel}
              handleLabel={copy.handleLabel}
              aspect="3 / 2"
            />
            <figcaption className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-ink/55">
              <span>{copy[p.styleKey]}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      <p className="mt-6 text-[10px] uppercase italic tracking-[0.18em] text-ink/45">
        {copy.disclaimer}
      </p>
    </section>
  );
}
