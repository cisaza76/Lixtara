// Placeholder for the 3D walkthrough tour. The previous provider (KIRI Engine)
// produced unusable quality and was removed 2026-06-16; the replacement 3DGS
// pipeline is still being chosen. Until then we show a premium "coming soon"
// teaser instead of a broken viewer/uploader. No client JS needed.

interface TourComingSoonProps {
  /** Optional small uppercase label above the title. */
  eyebrow?: string;
  title: string;
  body: string;
  /** Short pill text, e.g. "Coming soon" / "Muy pronto". */
  badge: string;
}

export function TourComingSoon({ eyebrow, title, body, badge }: TourComingSoonProps) {
  return (
    <div className="relative overflow-hidden border border-gold-soft bg-ivory-strong/30 p-6 lg:p-8">
      {/* faint 3D-cube motif, decorative only */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        className="pointer-events-none absolute -right-6 -bottom-8 h-44 w-44 text-gold/10"
      >
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <path d="M3.27 6.96 12 12.01l8.73-5.05" />
        <path d="M12 22.08V12" />
      </svg>

      <span className="absolute right-5 top-5 border border-gold-soft bg-ivory px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-ink/55">
        {badge}
      </span>

      <div className="relative flex items-start gap-5">
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

        <div className="flex flex-col gap-2 pr-16">
          {eyebrow && (
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              {eyebrow}
            </p>
          )}
          <p className="font-serif text-lg leading-snug text-ink lg:text-xl">{title}</p>
          <p className="max-w-prose text-sm leading-relaxed text-ink/70">{body}</p>
        </div>
      </div>
    </div>
  );
}
