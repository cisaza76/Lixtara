"use client";

import { useEffect, useRef, useState } from "react";
import type {
  SellerVideoMeta,
  SellerVideoState,
  SellerVideoStatusDto,
} from "@/lib/creative-studio/seller-video-status";
import type { Locale } from "@/lib/i18n";

interface Copy {
  title: string;
  subtitle: string;
  createCta: string;
  timeHint: string;
  disclosure: string;
  creatingHeading: string;
  creatingContext: string;
  creatingNote: string;
  readyHeading: string;
  madeFromChip: string;
  createdLabel: string;
  download: string;
  preview: string;
  errorHeading: string;
  errorReassurance: string;
  errorDetail: string;
  tryAgain: string;
  stillTrouble: string;
  contactSupport: string;
  sr: { creating: string; ready: string; failed: string };
}

// Shared Tailwind class strings so the primary link (download) and primary
// button render identically — matches the neutral shadcn idiom of the sibling
// MediaStrategyPanel.
const PRIMARY_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900";
const SECONDARY_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";
const SPINNER_CLASSES =
  "h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent motion-reduce:animate-none";

function formatMeta(meta: SellerVideoMeta, createdLabel: string, lang: string): string {
  const parts: string[] = [];
  const d = new Date(meta.createdAt);
  if (!Number.isNaN(d.getTime())) {
    parts.push(
      `${createdLabel} ${new Intl.DateTimeFormat(lang, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(d)}`,
    );
  }
  if (meta.durationSeconds != null) {
    const s = Math.round(meta.durationSeconds);
    parts.push(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
  }
  if (meta.resolutionLabel) parts.push(meta.resolutionLabel);
  return parts.join(" · ");
}

export function ListingVideoPanel({
  propertyId,
  lang,
  copy,
}: {
  propertyId: string;
  lang: Locale;
  copy: Copy;
}): React.JSX.Element {
  const [status, setStatus] = useState<SellerVideoStatusDto | null>(null);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Refs mirror the latest values so the polling interval (built once, deps
  // [propertyId]) reads fresh state without being torn down every render.
  const stateRef = useRef<SellerVideoState | null>(null);
  const pendingRef = useRef(false);

  async function refetch(): Promise<void> {
    try {
      const res = await fetch(
        `/api/creative-studio/video/status?property_id=${encodeURIComponent(propertyId)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as SellerVideoStatusDto;
      setStatus(data);
      if (data.state !== "idle") setCreateFailed(false);
    } catch {
      // Leave prior status intact; never clobber to null or crash.
    }
  }

  async function create(): Promise<void> {
    setPendingCreate(true);
    setCreateFailed(false);
    try {
      const res = await fetch("/api/creative-studio/video/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ property_id: propertyId }),
      });
      if (res.status === 202) {
        await refetch();
      } else {
        setCreateFailed(true);
      }
    } catch {
      setCreateFailed(true);
    } finally {
      setPendingCreate(false);
    }
  }

  // Sync the latest render state into refs (after commit) so the polling
  // interval reads fresh values without being re-created each render.
  useEffect(() => {
    stateRef.current = status?.state ?? null;
    pendingRef.current = pendingCreate;
  });

  // Polling: mount fetch + 3s interval that self-suppresses on hidden tab,
  // terminal states, and idle-with-no-pending-create. Never creates a job.
  useEffect(() => {
    // refetch() only calls setState after an `await` (post-commit microtask),
    // so this is not a synchronous cascading render — the rule is conservative.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refetch();

    function tick() {
      if (document.hidden) return;
      const current = stateRef.current;
      if (current === "completed" || current === "failed") return;
      if (current === "idle" && !pendingRef.current) return;
      void refetch();
    }

    function onVisibility() {
      if (!document.hidden) void refetch();
    }

    const interval = setInterval(tick, 3000);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  // Derive the visible view: a create attempt that produced no job surfaces the
  // failed overlay even though the server state is still idle.
  const view: SellerVideoState | null =
    status === null
      ? null
      : createFailed && status.state === "idle"
        ? "failed"
        : status.state;

  // aria-live text derived from the current view (empty for skeleton/idle).
  // Kept in the render tree so a change to this text node is announced.
  const announce =
    view === "creating"
      ? copy.sr.creating
      : view === "completed"
        ? copy.sr.ready
        : view === "failed"
          ? copy.sr.failed
          : "";

  return (
    <section className="rounded-xl border border-neutral-200 p-6">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <div className="flex flex-col gap-4">
        {view === null ? (
          <Skeleton title={copy.title} />
        ) : view === "creating" ? (
          <CreatingView copy={copy} />
        ) : view === "failed" ? (
          <FailedView copy={copy} lang={lang} pending={pendingCreate} onRetry={create} />
        ) : view === "completed" && status?.video ? (
          <CompletedView
            copy={copy}
            lang={lang}
            video={status.video}
            previewOpen={previewOpen}
            onPreview={() => setPreviewOpen(true)}
          />
        ) : view === "completed" ? (
          // Defensive: state says completed but the video payload is missing.
          <CreatingView copy={copy} />
        ) : (
          <IdleView copy={copy} pending={pendingCreate} onCreate={create} />
        )}
      </div>
    </section>
  );
}

function Skeleton({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="flex min-h-[168px] flex-col gap-4">
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-100 motion-reduce:animate-none" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-neutral-100 motion-reduce:animate-none" />
      <div className="h-24 w-full animate-pulse rounded bg-neutral-100 motion-reduce:animate-none" />
    </div>
  );
}

function IdleView({
  copy,
  pending,
  onCreate,
}: {
  copy: Copy;
  pending: boolean;
  onCreate: () => void;
}): React.JSX.Element {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold">{copy.title}</h3>
        <p className="text-sm text-neutral-500">{copy.subtitle}</p>
      </div>
      <div>
        <button type="button" onClick={onCreate} disabled={pending} className={PRIMARY_CLASSES}>
          {pending && <span className={SPINNER_CLASSES} aria-hidden="true" />}
          {copy.createCta}
        </button>
        <p className="mt-2 text-sm text-neutral-500">{copy.timeHint}</p>
      </div>
      <p className="text-sm text-neutral-500">{copy.disclosure}</p>
    </>
  );
}

function CreatingView({ copy }: { copy: Copy }): React.JSX.Element {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className={SPINNER_CLASSES} aria-hidden="true" />
        <h3 className="text-base font-medium">{copy.creatingHeading}</h3>
      </div>
      <p className="text-sm text-neutral-600">{copy.creatingContext}</p>
      <p className="text-sm text-neutral-500">{copy.creatingNote}</p>
    </>
  );
}

function CompletedView({
  copy,
  lang,
  video,
  previewOpen,
  onPreview,
}: {
  copy: Copy;
  lang: Locale;
  video: NonNullable<SellerVideoStatusDto["video"]>;
  previewOpen: boolean;
  onPreview: () => void;
}): React.JSX.Element {
  return (
    <>
      <h3 className="text-lg font-semibold">{copy.readyHeading}</h3>

      {previewOpen ? (
        <video
          controls
          autoPlay
          playsInline
          src={video.previewUrl}
          className="aspect-video w-full rounded-lg bg-black"
        />
      ) : (
        <div className="relative aspect-video w-full rounded-lg bg-neutral-900">
          <button
            type="button"
            aria-label={copy.preview}
            onClick={onPreview}
            className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-white/90 shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-7 w-7 text-[#B8945A]"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
        <span>{formatMeta(video.meta, copy.createdLabel, lang)}</span>
        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
          {copy.madeFromChip}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onPreview} className={PRIMARY_CLASSES}>
          {copy.preview}
        </button>
        <a href={video.downloadUrl} download className={SECONDARY_CLASSES}>
          {copy.download}
        </a>
      </div>
    </>
  );
}

function FailedView({
  copy,
  lang,
  pending,
  onRetry,
}: {
  copy: Copy;
  lang: Locale;
  pending: boolean;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <>
      <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-sm">
        <p className="font-medium">{copy.errorHeading}</p>
        <p className="mt-1">{copy.errorReassurance}</p>
        <p className="mt-1 text-neutral-500">{copy.errorDetail}</p>
      </div>
      <div className="flex flex-col gap-2">
        <div>
          <button type="button" onClick={onRetry} disabled={pending} className={PRIMARY_CLASSES}>
            {pending && <span className={SPINNER_CLASSES} aria-hidden="true" />}
            {copy.tryAgain}
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          {copy.stillTrouble}{" "}
          <a
            href={`/${lang}/contact?topic=listing-video`}
            className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
          >
            {copy.contactSupport}
          </a>
        </p>
      </div>
    </>
  );
}
