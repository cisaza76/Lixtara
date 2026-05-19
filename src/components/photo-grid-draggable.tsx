"use client";

// Drag-and-drop photo reorder using native HTML5 DnD (no libs). On drop we
// optimistically reorder client-side, then call the server action with the
// new id order. The first photo is auto-promoted to primary by the server.

import { useState, useTransition } from "react";

interface Photo {
  id: string;
  url: string;
  is_primary: boolean;
  display_order: number;
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
  const [, startTransition] = useTransition();

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
    // Mark only the first as primary client-side (server re-applies same rule)
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

  return (
    <div className="flex flex-col gap-3">
      {photos.length > 1 && (
        <p className="text-xs text-ink/55 italic">{labels.reorderHint}</p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {photos.map((photo) => (
          <div
            key={photo.id}
            draggable
            onDragStart={() => handleDragStart(photo.id)}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(photo.id)}
            className={`relative aspect-square overflow-hidden bg-ivory-strong border border-gold-soft group cursor-move transition-opacity ${
              draggingId === photo.id ? "opacity-40" : ""
            }`}
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
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 to-ink/0 p-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
          </div>
        ))}
      </div>
    </div>
  );
}
