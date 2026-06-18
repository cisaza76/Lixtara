"use client";

// Small ⓘ affordance: a plain-language explainer for one figure/label. Shows on
// hover (desktop) and on tap/focus (mobile + keyboard) via group-focus-within.
// Reused across the savings tables so every number can be understood by users
// with no financial background.

export function InfoTip({
  label,
  text,
  tone = "ink",
}: {
  label: string;
  text: string;
  tone?: "ink" | "ivory";
}) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
          tone === "ivory"
            ? "text-ivory/55 hover:text-gold"
            : "text-ink/35 hover:text-gold"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" strokeLinecap="round" />
          <circle cx="12" cy="7.6" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-56 -translate-x-1/2 rounded border border-gold-soft bg-ink px-3 py-2 text-left text-[11px] font-normal not-italic normal-case leading-snug tracking-normal text-ivory opacity-0 shadow-[0_18px_36px_-18px_rgba(28,28,28,0.6)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
