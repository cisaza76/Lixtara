import Link from "next/link";
import Image from "next/image";

// Presentational "command center" card for one seller listing. Pure server
// component — receives a fully-computed view model from the dashboard page and
// renders the premium layout. No data fetching, no client state.

export type Tone = "ok" | "warn" | "fail" | "draft" | "none";

export type WorkstreamIcon =
  | "listing"
  | "agreement"
  | "payment"
  | "staging"
  | "video"
  | "offers";

export interface Workstream {
  icon: WorkstreamIcon;
  label: string;
  value: string;
  tone: Tone;
}

export interface Metric {
  label: string;
  value: string;
}

export interface NextStep {
  text: string;
  ctaLabel: string;
  ctaHref: string;
}

export interface SellerListingCardProps {
  photo?: string;
  address: string;
  cityLine: string;
  price: string;
  statusText: string;
  statusTone: Tone;
  tierText?: string;
  offersBadge?: string;
  noPhotosLabel: string;
  workingEyebrow: string;
  metricsLabel: string;
  nextStepLabel: string;
  workstreams: Workstream[];
  metrics: Metric[];
  nextStep: NextStep;
  primaryHref: string;
  primaryLabel: string;
}

const TILE_TONE: Record<Tone, string> = {
  ok: "border-gold/40 bg-gold/[0.05]",
  warn: "border-gold-soft bg-ivory-strong/40",
  fail: "border-red-200 bg-red-50/60",
  draft: "border-gold-soft bg-ivory-strong/25",
  none: "border-gold-soft/70 bg-ivory",
};

const DOT_TONE: Record<Tone, string> = {
  ok: "bg-gold",
  warn: "bg-transparent ring-1 ring-inset ring-gold/60",
  fail: "bg-red-400",
  draft: "bg-ink/15",
  none: "bg-ink/15",
};

const STATUS_BADGE_TONE: Record<Tone, string> = {
  ok: "border-gold bg-gold/10 text-ink",
  warn: "border-gold-soft bg-ivory/90 text-ink/80",
  fail: "border-red-300 bg-red-50 text-red-800",
  draft: "border-gold-soft bg-ivory/90 text-ink/60",
  none: "border-gold-soft bg-ivory/90 text-ink/55",
};

function WorkstreamGlyph({ icon }: { icon: WorkstreamIcon }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (icon) {
    case "listing":
      return (
        <svg {...common}>
          <path d="M3 10.5 12 4l9 6.5" />
          <path d="M5 9.5V20h14V9.5" />
        </svg>
      );
    case "agreement":
      return (
        <svg {...common}>
          <path d="M7 3h7l5 5v13H7z" />
          <path d="M14 3v5h5" />
          <path d="M9.5 14.5l1.5 1.5 3.5-3.5" />
        </svg>
      );
    case "payment":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="1.5" />
          <path d="M3 10h18" />
        </svg>
      );
    case "staging":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="14" rx="1.5" />
          <path d="M3 14l5-4 4 3 3-2 6 4" />
        </svg>
      );
    case "video":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="13" height="12" rx="1.5" />
          <path d="M16 10l5-3v10l-5-3z" />
        </svg>
      );
    case "offers":
      return (
        <svg {...common}>
          <path d="M12 21s-7-4.4-9.2-8.4A4.6 4.6 0 0 1 12 6.8a4.6 4.6 0 0 1 9.2 5.8C19 16.6 12 21 12 21z" />
        </svg>
      );
  }
}

export function SellerListingCard({
  photo,
  address,
  cityLine,
  price,
  statusText,
  statusTone,
  tierText,
  offersBadge,
  noPhotosLabel,
  workingEyebrow,
  metricsLabel,
  nextStepLabel,
  workstreams,
  metrics,
  nextStep,
  primaryHref,
  primaryLabel,
}: SellerListingCardProps) {
  return (
    <article className="overflow-hidden border border-gold-soft bg-ivory transition-all duration-300 hover:border-gold/50 hover:shadow-[0_28px_56px_-32px_rgba(28,28,28,0.32)]">
      <div className="grid md:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)]">
        {/* Visual column */}
        <div className="relative min-h-[220px] bg-ivory-strong md:min-h-full">
          {photo ? (
            <Image
              src={photo}
              alt={address}
              fill
              sizes="(min-width: 768px) 420px, 100vw"
              className="object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-[0.22em] text-ink/40">
              {noPhotosLabel}
            </div>
          )}
          <span
            className={`absolute left-3 top-3 inline-block border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${STATUS_BADGE_TONE[statusTone]}`}
          >
            {statusText}
          </span>
          {offersBadge && (
            <span className="absolute right-3 top-3 inline-block bg-gold px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink">
              {offersBadge}
            </span>
          )}
        </div>

        {/* Detail column */}
        <div className="flex flex-col gap-5 p-6 lg:p-7">
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-xl leading-tight text-ink">
              {address}
            </h3>
            <p className="text-xs text-ink/55">{cityLine}</p>
            <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-gold-soft pt-3">
              <span className="font-display text-2xl italic text-ink">
                <span className="align-top text-sm text-gold">$</span>
                {price}
              </span>
              {tierText && (
                <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                  {tierText}
                </span>
              )}
            </div>
          </div>

          {/* Workstreams — what Lixtara is doing for this listing */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                className="text-gold"
              >
                <path d="M12 2l1.9 5.6L19.5 9l-4.6 1.4L12 16l-2.9-5.6L4.5 9l5.6-1.4z" />
              </svg>
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">
                {workingEyebrow}
              </span>
            </div>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {workstreams.map((ws) => (
                <li
                  key={ws.label}
                  className={`flex items-center gap-2.5 border px-3 py-2.5 ${TILE_TONE[ws.tone]}`}
                >
                  <span className="shrink-0 text-ink/70">
                    <WorkstreamGlyph icon={ws.icon} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-[9px] uppercase tracking-[0.16em] text-ink/50">
                      {ws.label}
                    </span>
                    <span className="truncate text-[11px] font-medium text-ink">
                      {ws.value}
                    </span>
                  </span>
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${DOT_TONE[ws.tone]}`}
                    aria-hidden="true"
                  />
                </li>
              ))}
            </ul>
          </div>

          {/* Performance metrics */}
          <div className="border-t border-gold-soft pt-4">
            <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-ink/45">
              {metricsLabel}
            </span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {metrics.map((m) => (
                <div key={m.label} className="flex flex-col gap-0.5">
                  <span className="font-display text-xl leading-none text-ink">
                    {m.value}
                  </span>
                  <span className="text-[9px] uppercase tracking-[0.16em] text-ink/50">
                    {m.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Recommended next step */}
          <div className="flex flex-col gap-3 border border-gold/40 bg-gold/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-gold"
              >
                <path d="M5 12h14" />
                <path d="M13 6l6 6-6 6" />
              </svg>
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-gold">
                  {nextStepLabel}
                </span>
                <p className="text-sm leading-snug text-ink/80">
                  {nextStep.text}
                </p>
              </div>
            </div>
            <Link
              href={nextStep.ctaHref}
              className="inline-flex shrink-0 items-center justify-center whitespace-nowrap bg-ink px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory transition-colors hover:bg-ink/85"
            >
              {nextStep.ctaLabel} →
            </Link>
          </div>

          <Link
            href={primaryHref}
            className="text-[10px] uppercase tracking-[0.22em] text-gold transition-colors hover:text-ink"
          >
            {primaryLabel}
          </Link>
        </div>
      </div>
    </article>
  );
}
