// Placeholder for the 3D walkthrough tour. The previous provider (KIRI Engine)
// produced unusable quality and was removed 2026-06-16; the replacement 3DGS
// pipeline is still being chosen. Until then we show a tasteful "coming soon"
// card instead of a broken viewer/uploader. No client JS needed.

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
    <div className="border border-gold-soft bg-ivory-strong/30 p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        {eyebrow ? (
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
            {eyebrow}
          </p>
        ) : (
          <span />
        )}
        <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink/55 border border-gold-soft px-2.5 py-1">
          {badge}
        </span>
      </div>
      <p className="font-serif text-lg text-ink">{title}</p>
      <p className="text-sm text-ink/70 leading-relaxed">{body}</p>
    </div>
  );
}
