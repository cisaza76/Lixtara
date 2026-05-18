"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type JobStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "expired";

interface TourUploaderProps {
  propertyId: string;
  initialJob: { status: JobStatus } | null;
  labels: {
    fileLabel: string;
    uploadButton: string;
    uploading: string;
    queued: string;
    processing: string;
    ready: string;
    failed: string;
    expired: string;
    replaceButton: string;
    fileTooLarge: string;
    genericError: string;
  };
}

const MAX_BYTES = 500 * 1024 * 1024;

export function TourUploader({ propertyId, initialJob, labels }: TourUploaderProps) {
  const [status, setStatus] = useState<JobStatus | null>(initialJob?.status ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formEl = e.currentTarget;
    const fileInput = formEl.elements.namedItem("video") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(labels.fileTooLarge);
      return;
    }

    setIsSubmitting(true);
    setStatus("uploading");

    try {
      // 1. Upload directly to Supabase Storage (bypasses Vercel 4.5MB cap)
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("not_authenticated");

      const ext = (file.name.split(".").pop() ?? "mp4").toLowerCase();
      const storagePath = `${propertyId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("tour-videos")
        .upload(storagePath, file, {
          contentType: file.type || "video/mp4",
          upsert: false,
        });
      if (upErr) throw new Error(`storage_upload_failed: ${upErr.message}`);

      // 2. POST tiny JSON to the server, which streams from Storage to KIRI
      const res = await fetch("/api/tours/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_id: propertyId,
          storage_path: storagePath,
          size_bytes: file.size,
          filename: file.name || `tour-${propertyId}.${ext}`,
        }),
      });
      const data = (await res.json()) as { error?: string; job_id?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "submit_failed");
      }
      setStatus("queued");
      formEl.reset();
    } catch (e) {
      setStatus("failed");
      setError(e instanceof Error ? e.message : labels.genericError);
    } finally {
      setIsSubmitting(false);
    }
  }

  const statusMessage =
    status === "uploading"
      ? labels.uploading
      : status === "queued"
        ? labels.queued
        : status === "processing"
          ? labels.processing
          : status === "ready"
            ? labels.ready
            : status === "failed"
              ? labels.failed
              : status === "expired"
                ? labels.expired
                : null;

  const showForm = status === null || status === "failed" || status === "expired" || status === "ready";

  return (
    <div className="flex flex-col gap-4">
      {statusMessage && (
        <div
          className={`text-sm leading-relaxed px-4 py-3 border ${
            status === "ready"
              ? "border-gold bg-gold/5 text-ink"
              : status === "failed" || status === "expired"
                ? "border-red-300 bg-red-50 text-red-800"
                : "border-gold-soft bg-ivory-strong/40 text-ink/80"
          }`}
        >
          {statusMessage}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-700 italic font-mono break-all">
          {error}
        </p>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
              {labels.fileLabel}
            </span>
            <input
              type="file"
              name="video"
              accept="video/mp4,video/quicktime,video/webm"
              required
              disabled={isSubmitting}
              className="text-sm text-ink file:mr-4 file:py-2 file:px-4 file:border file:border-gold-soft file:bg-ivory file:text-ink file:text-[10px] file:font-semibold file:uppercase file:tracking-[0.22em] file:cursor-pointer hover:file:border-gold disabled:opacity-50"
            />
          </label>
          <button
            type="submit"
            disabled={isSubmitting}
            className="self-start inline-flex items-center justify-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === "ready" || status === "failed" || status === "expired"
              ? labels.replaceButton
              : labels.uploadButton}
          </button>
        </form>
      )}
    </div>
  );
}
