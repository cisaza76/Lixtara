"use client";

// F4.4 — Source Video preview. A THIN client consumer of the owner-only /source/preview
// endpoint. It fetches a TEMPORARY MEDIA-ACCESS descriptor LAZILY (only when the seller asks
// to play), renews it REACTIVELY (on a play request when expired, or when playback fails due
// to expiry) — NEVER on a timer — and never persists the access URL. It does not depend on
// the browser showing a first frame (poster is best-effort only). No render/preparation.
import { useEffect, useRef, useState } from "react";
import { isAccessExpired, type SourcePreviewDto, type TemporaryMediaAccess } from "@/lib/creative-studio/source-preview";

export interface SourceVideoPreviewCopy {
  play: string;
  expand: string;
  close: string;
  loading: string;
  error: string;
  retry: string;
  sr: { loading: string; playing: string; error: string };
}

const SPINNER =
  "h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent motion-reduce:animate-none";

export function SourceVideoPreview({
  propertyId,
  copy,
}: {
  propertyId: string;
  copy: SourceVideoPreviewCopy;
}): React.JSX.Element {
  const [access, setAccess] = useState<TemporaryMediaAccess | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [expanded, setExpanded] = useState(false);
  const retriedRef = useRef(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Fetch/renew the ephemeral access. `force` re-fetches even if the current grant looks
  // valid (used after a playback error). Reactive only — never called on a timer.
  async function ensureAccess(force: boolean): Promise<TemporaryMediaAccess | null> {
    if (!force && access && !isAccessExpired(access, Date.now())) return access;
    try {
      const res = await fetch(`/api/creative-studio/video/source/preview?listingId=${encodeURIComponent(propertyId)}`);
      if (!res.ok) return null;
      const dto = (await res.json()) as SourcePreviewDto;
      if (!dto.exists || !dto.preview) return null;
      setAccess(dto.preview.access);
      return dto.preview.access;
    } catch {
      return null;
    }
  }

  async function play(): Promise<void> {
    setState("loading");
    retriedRef.current = false;
    const a = await ensureAccess(false);
    if (!a) {
      setState("error");
      return;
    }
    setState("playing");
  }

  // <video> error is how an EXPIRED signed URL surfaces (403). Renew ONCE, reactively.
  async function onVideoError(): Promise<void> {
    if (retriedRef.current) {
      setState("error");
      return;
    }
    retriedRef.current = true;
    const a = await ensureAccess(true);
    if (!a) setState("error");
    // a successful renew updates `access`; the <video> src (derived from access) re-loads.
  }

  useEffect(() => {
    if (expanded) closeBtnRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false);
    }
    if (expanded) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  const announce =
    state === "loading" ? copy.sr.loading : state === "error" ? copy.sr.error : state === "playing" ? copy.sr.playing : "";

  const videoEl = access ? (
    <video
      key={access.locator}
      controls
      playsInline
      preload="metadata"
      src={access.locator}
      onError={() => void onVideoError()}
      className="aspect-video w-full rounded-lg bg-black"
    />
  ) : null;

  return (
    <div className="flex flex-col gap-2">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {state === "playing" && videoEl ? (
        <div className="flex flex-col gap-2">
          {videoEl}
          <div>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
            >
              {copy.expand}
            </button>
          </div>
        </div>
      ) : state === "error" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-amber-700" role="alert">
            {copy.error}
          </p>
          <div>
            <button
              type="button"
              onClick={() => void play()}
              className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
            >
              {copy.retry}
            </button>
          </div>
        </div>
      ) : (
        // Placeholder — no poster guaranteed (the browser MAY show a first frame once playing;
        // the UI does not depend on it).
        <button
          type="button"
          onClick={() => void play()}
          disabled={state === "loading"}
          aria-label={copy.play}
          className="relative flex aspect-video w-full items-center justify-center rounded-lg bg-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
          {state === "loading" ? (
            <span className={SPINNER} aria-hidden="true" />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 shadow">
              <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#B8945A]" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          )}
        </button>
      )}

      {expanded && videoEl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={copy.play}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExpanded(false);
          }}
        >
          <div className="flex w-full max-w-3xl flex-col gap-3">
            {videoEl}
            <div className="flex justify-end">
              <button
                ref={closeBtnRef}
                type="button"
                onClick={() => setExpanded(false)}
                className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                {copy.close}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
