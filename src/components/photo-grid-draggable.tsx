"use client";

// Drag-and-drop photo reorder using native HTML5 DnD (no libs). On drop we
// optimistically reorder client-side, then call the server action with the
// new id order. The first photo is auto-promoted to primary by the server.
//
// Also hosts the "Stage with AI" trigger — calls /api/staging/generate which
// returns a new staged photo row that we append optimistically.

import { useState, useTransition } from "react";
import { STAGING_STYLES, type StagingStyle } from "@/lib/staging";

interface Photo {
  id: string;
  url: string;
  is_primary: boolean;
  display_order: number;
  is_staged?: boolean;
  original_photo_id?: string | null;
}

interface PhotoGridDraggableProps {
  propertyId: string;
  initialPhotos: Photo[];
  persistAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
  labels: {
    primaryBadge: string;
    deleteButton: string;
    reorderHint: string;
    stageButton: string;
    stagingNow: string;
    stagingFailed: string;
    stagedBadge: string;
    pickStyle: string;
    cancelStyle: string;
    styleModern: string;
    styleMinimalist: string;
    styleTraditional: string;
    styleWarm: string;
    creditsTitle: string;
    creditsBody: string;
    creditsCta: string;
    creditsRedirecting: string;
  };
}

export function PhotoGridDraggable({
  propertyId,
  initialPhotos,
  persistAction,
  deleteAction,
  labels,
}: PhotoGridDraggableProps) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [stagingInFlight, setStagingInFlight] = useState<Set<string>>(new Set());
  const [stagingError, setStagingError] = useState<string | null>(null);
  const [needsCredits, setNeedsCredits] = useState(false);
  const [buyingCredits, setBuyingCredits] = useState(false);
  const [, startTransition] = useTransition();

  async function handleBuyCredits() {
    setBuyingCredits(true);
    try {
      const lang =
        window.location.pathname.split("/")[1] === "es" ? "es" : "en";
      const res = await fetch("/api/checkout/staging-overage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId, quantity: 1, lang }),
      });
      if (res.status === 401) {
        window.location.href = `/${lang}/sign-in`;
        return;
      }
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "no_url");
      window.location.href = data.url;
    } catch {
      setBuyingCredits(false);
    }
  }

  const styleLabel: Record<StagingStyle, string> = {
    modern: labels.styleModern,
    minimalist: labels.styleMinimalist,
    traditional: labels.styleTraditional,
    warm: labels.styleWarm,
  };

  function handleDragStart(id: string) {
    setDraggingId(id);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }

  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }
    const newOrder = [...photos];
    const fromIdx = newOrder.findIndex((p) => p.id === draggingId);
    const toIdx = newOrder.findIndex((p) => p.id === targetId);
    if (fromIdx < 0 || toIdx < 0) {
      setDraggingId(null);
      return;
    }
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, moved);
    const annotated = newOrder.map((p, i) => ({
      ...p,
      is_primary: i === 0,
      display_order: i,
    }));
    setPhotos(annotated);
    setDraggingId(null);

    const fd = new FormData();
    fd.append("id", propertyId);
    for (const p of annotated) fd.append("ids", p.id);
    startTransition(async () => {
      try {
        await persistAction(fd);
      } catch {
        // server action redirects throw — that's the success path. Swallow.
      }
    });
  }

  async function handleStage(photoId: string, style: StagingStyle) {
    setPickerFor(null);
    setStagingError(null);
    setNeedsCredits(false);
    setStagingInFlight((s) => new Set(s).add(photoId));
    try {
      const res = await fetch("/api/staging/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_id: photoId, style }),
      });
      const data = (await res.json()) as {
        photo?: {
          id: string;
          url: string;
          is_staged: boolean;
          original_photo_id: string | null;
        };
        error?: string;
      };
      // Free quota used up → prompt to buy credits instead of erroring.
      if (res.status === 402 || data.error === "staging_payment_required") {
        setNeedsCredits(true);
        return;
      }
      if (!res.ok || !data.photo) {
        throw new Error(data.error ?? "stage_failed");
      }
      setPhotos((curr) => [
        ...curr,
        {
          id: data.photo!.id,
          url: data.photo!.url,
          is_primary: false,
          display_order: curr.length,
          is_staged: true,
          original_photo_id: data.photo!.original_photo_id,
        },
      ]);
    } catch (e) {
      setStagingError(
        e instanceof Error ? `${labels.stagingFailed} (${e.message})` : labels.stagingFailed,
      );
    } finally {
      setStagingInFlight((s) => {
        const n = new Set(s);
        n.delete(photoId);
        return n;
      });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {photos.length > 1 && (
        <p className="text-xs text-ink/55 italic">{labels.reorderHint}</p>
      )}
      {stagingError && (
        <p className="text-xs text-red-700 italic font-mono break-all">
          {stagingError}
        </p>
      )}
      {needsCredits && (
        <div className="flex flex-col gap-2 border border-gold bg-gold/5 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
            {labels.creditsTitle}
          </p>
          <p className="text-sm leading-relaxed text-ink/80">
            {labels.creditsBody}
          </p>
          <button
            type="button"
            onClick={handleBuyCredits}
            disabled={buyingCredits}
            className="mt-1 inline-flex items-center justify-center self-start bg-ink px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-ivory transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {buyingCredits ? labels.creditsRedirecting : labels.creditsCta}
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {photos.map((photo) => {
          const isStaging = stagingInFlight.has(photo.id);
          const showPicker = pickerFor === photo.id;
          return (
            <div
              key={photo.id}
              draggable={!isStaging}
              onDragStart={() => handleDragStart(photo.id)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(photo.id)}
              className={`relative aspect-square overflow-hidden bg-ivory-strong border border-gold-soft group cursor-move transition-opacity ${
                draggingId === photo.id ? "opacity-40" : ""
              } ${isStaging ? "opacity-60" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt=""
                className="w-full h-full object-cover pointer-events-none"
              />

              {photo.is_primary && (
                <div className="absolute top-2 left-2 bg-gold text-ink text-[9px] font-semibold tracking-[0.2em] uppercase px-2 py-1 pointer-events-none">
                  {labels.primaryBadge}
                </div>
              )}

              {photo.is_staged && (
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-ink/85 text-ivory text-[9px] font-semibold tracking-[0.2em] uppercase px-2 py-1 pointer-events-none">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 2l1.9 5.6L19.5 9l-4.6 1.4L12 16l-2.9-5.6L4.5 9l5.6-1.4z" />
                  </svg>
                  {labels.stagedBadge}
                </div>
              )}

              {isStaging && (
                <div className="absolute inset-0 flex items-center justify-center bg-ivory/70 pointer-events-none">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink animate-pulse">
                    {labels.stagingNow}
                  </p>
                </div>
              )}

              {/* Style picker overlay — shown only when user clicked Stage */}
              {showPicker && !isStaging && (
                <div className="absolute inset-0 bg-ink/90 p-3 flex flex-col gap-2 justify-center">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-gold text-center">
                    {labels.pickStyle}
                  </p>
                  {STAGING_STYLES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleStage(photo.id, s)}
                      className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ivory border border-gold-soft py-1.5 hover:bg-gold hover:text-ink transition-colors"
                    >
                      {styleLabel[s]}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPickerFor(null)}
                    className="text-[9px] uppercase tracking-[0.18em] text-ivory/60 hover:text-ivory mt-1"
                  >
                    {labels.cancelStyle}
                  </button>
                </div>
              )}

              {/* Hover action bar — Stage + Delete */}
              {!showPicker && !isStaging && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 to-ink/0 p-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!photo.is_staged && (
                    <button
                      type="button"
                      onClick={() => setPickerFor(photo.id)}
                      className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-ivory hover:text-gold"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 2l1.9 5.6L19.5 9l-4.6 1.4L12 16l-2.9-5.6L4.5 9l5.6-1.4z" />
                      </svg>
                      {labels.stageButton}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const fd = new FormData();
                      fd.append("id", propertyId);
                      fd.append("photo_id", photo.id);
                      fd.append("url", photo.url);
                      startTransition(async () => {
                        try {
                          await deleteAction(fd);
                        } catch {
                          // server action redirects throw; treat as success
                        }
                      });
                      // optimistic
                      setPhotos((curr) => curr.filter((p) => p.id !== photo.id));
                    }}
                    className="ml-auto text-[9px] font-semibold uppercase tracking-[0.18em] text-ivory hover:text-red-300"
                  >
                    {labels.deleteButton}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
