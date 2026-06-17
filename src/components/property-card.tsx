import Image from "next/image";
import Link from "next/link";
import type { PropertySummary } from "@/lib/properties";
import { formatPropertyPrice, cleanDemoPrefix } from "@/lib/properties";

export interface PropertyCardLabels {
  viewDetails: string;
  forSale: string;
  bedsShort: string;
  bathsShort: string;
  sqftSuffix: string;
}

interface Props {
  lang: string;
  property: PropertySummary;
  labels: PropertyCardLabels;
  isDemo?: boolean;
  /** eager-load above-the-fold images for LCP */
  priority?: boolean;
}

// Small line icons (no emoji), 14px, inherit color.
function Spec({
  icon,
  value,
  unit,
}: {
  icon: React.ReactNode;
  value: string;
  unit: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-ink/45">{icon}</span>
      <span className="text-ink/75 font-medium">{value}</span>
      <span className="text-ink/45">{unit}</span>
    </span>
  );
}

const iconProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function PropertyCard({ lang, property: p, labels, isDemo, priority }: Props) {
  const street = cleanDemoPrefix(p.address_street);
  return (
    <Link
      href={`/${lang}/property/${p.id}`}
      className="group flex flex-col gap-4"
    >
      <div className="relative aspect-[4/3] overflow-hidden border border-gold-soft bg-ivory-strong transition-all duration-300 group-hover:border-gold/60 group-hover:shadow-[0_24px_48px_-24px_rgba(28,28,28,0.35)]">
        {p.primary_photo_url ? (
          <Image
            src={p.primary_photo_url}
            alt={street}
            fill
            priority={priority}
            sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover transition-transform duration-[650ms] ease-out group-hover:scale-[1.045]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.18em] text-ink/30">
            No photo
          </div>
        )}
        {/* hover scrim for depth */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ink/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        {/* status pill */}
        <span
          className={`absolute left-3 top-3 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.22em] ${
            isDemo ? "bg-ink text-ivory" : "bg-ivory/95 text-ink"
          }`}
        >
          {isDemo ? "Demo" : labels.forSale}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-2xl leading-none text-ink lg:text-[1.7rem]">
            {formatPropertyPrice(p.list_price)}
          </span>
          <span className="-translate-x-1 whitespace-nowrap text-[10px] uppercase tracking-[0.18em] text-gold opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100">
            {labels.viewDetails} →
          </span>
        </div>
        <div className="text-sm leading-snug text-ink">{street}</div>
        <div className="text-sm leading-snug text-ink/55">
          {p.address_city}, {p.address_state} {p.address_zip}
        </div>
        <div className="mt-3 flex items-center gap-4 border-t border-gold-soft pt-3 text-[11px] uppercase tracking-[0.12em]">
          <Spec
            value={String(p.bedrooms)}
            unit={labels.bedsShort}
            icon={
              <svg {...iconProps}>
                <path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6" />
                <path d="M3 14h18" />
                <path d="M7 10V8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
                <path d="M13 10V8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
                <path d="M4 18v2M20 18v2" />
              </svg>
            }
          />
          <span className="text-gold-soft">·</span>
          <Spec
            value={String(p.bathrooms)}
            unit={labels.bathsShort}
            icon={
              <svg {...iconProps}>
                <path d="M4 12V6a2 2 0 0 1 3.9-.6" />
                <path d="M2 12h20v3a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" />
                <path d="M7 19l-1 2M17 19l1 2" />
              </svg>
            }
          />
          <span className="text-gold-soft">·</span>
          <Spec
            value={p.sqft.toLocaleString()}
            unit={labels.sqftSuffix}
            icon={
              <svg {...iconProps}>
                <path d="M3 8V5a2 2 0 0 1 2-2h3" />
                <path d="M16 3h3a2 2 0 0 1 2 2v3" />
                <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
                <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
              </svg>
            }
          />
        </div>
      </div>
    </Link>
  );
}
