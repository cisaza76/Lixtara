"use client";

// Small ⓘ affordance: a plain-language explainer for one figure/label. Opens on
// hover (desktop) and on tap/click (mobile + keyboard). The popup is portalled
// to <body> and collision-aware, so it is never clipped by an overflow
// container (e.g. the horizontally scrollable savings table) or the viewport
// edge on narrow screens. Reused across the savings tables so every number can
// be understood by users with no financial background.

import { Popover } from "@base-ui/react/popover";

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
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={80}
        closeDelay={80}
        aria-label={label}
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full align-middle focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
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
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          sideOffset={8}
          collisionPadding={12}
          className="z-50"
        >
          <Popover.Popup className="w-64 max-w-[calc(100vw-24px)] rounded border border-gold-soft bg-ink px-3 py-2 text-left text-[11px] font-normal not-italic normal-case leading-snug tracking-normal text-ivory shadow-[0_18px_36px_-18px_rgba(28,28,28,0.6)] outline-none transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            {text}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
