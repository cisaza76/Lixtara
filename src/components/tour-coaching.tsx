// Seller-side premium coaching panel for the 3D / premium video tour.
// The capture engine is not yet wired, so this is INFORMATIONAL ONLY:
// a premium "in preparation" state + a how-to-record guide + a disabled
// early-access CTA. No upload, no storage, no backend — it never implies
// immediate processing. When the engine is chosen, real upload replaces this.

export interface TourCoachingCopy {
  eyebrow: string;
  status: string;
  title: string;
  body: string;
  guideTitle: string;
  tips: readonly string[];
  cta: string;
}

export function TourCoaching({ copy }: { copy: TourCoachingCopy }) {
  return (
    <div className="relative overflow-hidden border border-gold-soft bg-ivory-strong/30 p-6 lg:p-8">
      {/* faint 3D-cube motif, decorative */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        className="pointer-events-none absolute -right-8 -bottom-10 h-48 w-48 text-gold/10"
      >
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <path d="M3.27 6.96 12 12.01l8.73-5.05" />
        <path d="M12 22.08V12" />
      </svg>

      <div className="relative flex flex-col gap-6">
        {/* header: eyebrow + status pill */}
        <div className="flex items-center justify-between gap-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
            {copy.eyebrow}
          </p>
          <span className="inline-flex items-center gap-1.5 border border-gold-soft bg-ivory px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-ink/60">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            {copy.status}
          </span>
        </div>

        {/* medallion + title + microcopy */}
        <div className="flex items-start gap-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-gold-soft bg-ivory text-gold">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
            >
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <path d="M3.27 6.96 12 12.01l8.73-5.05" />
              <path d="M12 22.08V12" />
            </svg>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-display text-lg leading-snug text-ink lg:text-xl">
              {copy.title}
            </p>
            <p className="max-w-prose text-sm leading-relaxed text-ink/70">
              {copy.body}
            </p>
          </div>
        </div>

        {/* recording guide */}
        <div className="border-t border-gold-soft pt-6">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {copy.guideTitle}
          </p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {copy.tips.map((tip) => (
              <li key={tip} className="flex items-start gap-2.5">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-gold"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span className="text-sm leading-snug text-ink/75">{tip}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* disabled early-access CTA */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="inline-flex w-full cursor-not-allowed items-center justify-center border border-gold-soft bg-ivory px-6 py-3.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/45 sm:w-auto"
        >
          {copy.cta}
        </button>
      </div>
    </div>
  );
}
