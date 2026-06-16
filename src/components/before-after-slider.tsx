"use client";

// Premium before/after comparison slider for AI Virtual Staging.
// - Pointer (mouse + touch via Pointer Events), click-to-position, and full
//   keyboard support (role=slider, Arrow keys, Home/End).
// - No layout shift: fixed aspect-ratio box; images are object-cover and the
//   "before" layer is revealed via clip-path (responsive, no inner sizing).
// - Respects prefers-reduced-motion (no transition on the divider while idle).

import { useCallback, useEffect, useRef, useState } from "react";

interface BeforeAfterSliderProps {
  beforeSrc: string;
  afterSrc: string;
  /** alt for the unfurnished/original image */
  beforeAlt: string;
  /** alt for the AI-staged image */
  afterAlt: string;
  beforeLabel: string;
  afterLabel: string;
  /** aria label for the divider handle, e.g. "Drag to compare" */
  handleLabel: string;
  /** CSS aspect-ratio for the frame, default "3 / 2" */
  aspect?: string;
}

export function BeforeAfterSlider({
  beforeSrc,
  afterSrc,
  beforeAlt,
  afterAlt,
  beforeLabel,
  afterLabel,
  handleLabel,
  aspect = "3 / 2",
}: BeforeAfterSliderProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50); // percent revealed of the "before" image
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState(true); // subtle first-use affordance

  const setFromClientX = useCallback((clientX: number) => {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(100, Math.max(0, pct)));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => setFromClientX(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, setFromClientX]);

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 10 : 4;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPos((p) => Math.max(0, p - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPos((p) => Math.min(100, p + step));
    } else if (e.key === "Home") {
      e.preventDefault();
      setPos(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setPos(100);
    }
  }

  return (
    <div
      ref={frameRef}
      className="group relative w-full overflow-hidden border border-gold-soft bg-ivory-strong select-none touch-none"
      style={{ aspectRatio: aspect }}
      onPointerDown={(e) => {
        setHint(false);
        setDragging(true);
        setFromClientX(e.clientX);
      }}
    >
      {/* AFTER (staged) — base layer */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={afterSrc}
        alt={afterAlt}
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* BEFORE (original) — revealed from the left via clip-path */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={beforeSrc}
        alt={beforeAlt}
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />

      {/* Corner labels */}
      <span className="pointer-events-none absolute left-3 top-3 bg-ink/85 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-ivory">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute right-3 top-3 bg-gold px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-ink">
        {afterLabel}
      </span>

      {/* Divider + handle */}
      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-ivory/90 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]"
        style={{ left: `${pos}%` }}
      >
        <div
          role="slider"
          tabIndex={0}
          aria-label={handleLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          onKeyDown={onKeyDown}
          onFocus={() => setHint(false)}
          className="pointer-events-auto absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-gold-soft bg-ivory text-ink shadow-md outline-none transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink/0 group-hover:scale-105 motion-reduce:transition-none"
        >
          {/* dual chevrons */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 7l-5 5 5 5" />
            <path d="M15 7l5 5-5 5" />
          </svg>
        </div>
        {/* first-use drag hint */}
        {hint && (
          <span className="pointer-events-none absolute left-1/2 top-[calc(50%+2rem)] -translate-x-1/2 whitespace-nowrap rounded-full bg-ink/80 px-2.5 py-1 text-[9px] font-medium uppercase tracking-[0.18em] text-ivory motion-safe:animate-pulse">
            {handleLabel}
          </span>
        )}
      </div>
    </div>
  );
}
