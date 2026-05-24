"use client";

import { useEffect, useRef, useState } from "react";
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
    coachingTitle: string;
    tip1: string;
    tip2: string;
    tip3: string;
    tip4: string;
    durationLabel: string;
    resolutionLabel: string;
    preflightOk: string;
    preflightWarn: string;
    preflightTooShort: string;
    preflightTooLow: string;
    preflightReading: string;
  };
}

const MAX_BYTES = 500 * 1024 * 1024;
// 3DGS quality is bimodal — under these floors the reconstruction is too
// sparse to be sharp regardless of vendor. Numbers come from our 2026-05-23
// debug session (30s sweep → 358k gaussians → unusable).
const HARD_MIN_DURATION_SEC = 30;
const SOFT_MIN_DURATION_SEC = 60;
const HARD_MIN_RES = 480;
const SOFT_MIN_RES = 720;

interface Preflight {
  duration: number;
  width: number;
  height: number;
  durationOk: "ok" | "warn" | "fail";
  resolutionOk: "ok" | "warn" | "fail";
}

async function probeVideo(file: File): Promise<Preflight | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      const minRes = Math.min(v.videoWidth, v.videoHeight);
      const dur = v.duration;
      const result: Preflight = {
        duration: dur,
        width: v.videoWidth,
        height: v.videoHeight,
        durationOk:
          dur < HARD_MIN_DURATION_SEC
            ? "fail"
            : dur < SOFT_MIN_DURATION_SEC
              ? "warn"
              : "ok",
        resolutionOk:
          minRes < HARD_MIN_RES ? "fail" : minRes < SOFT_MIN_RES ? "warn" : "ok",
      };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    v.src = url;
  });
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TourUploader({ propertyId, initialJob, labels }: TourUploaderProps) {
  const [status, setStatus] = useState<JobStatus | null>(initialJob?.status ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [probing, setProbing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cancel any in-flight probe if the component unmounts while probing.
  useEffect(() => () => setProbing(false), []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setPreflight(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(labels.fileTooLarge);
      return;
    }
    setProbing(true);
    const pf = await probeVideo(file);
    setProbing(false);
    if (pf) setPreflight(pf);
  }

  const hardFail =
    preflight?.durationOk === "fail" || preflight?.resolutionOk === "fail";

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
    if (hardFail) {
      // The preflight panel already explains why; just block.
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
      setPreflight(null);
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
        <>
          {/* Coaching panel — always visible. 3DGS quality is bimodal; these
              four rules are the difference between a sharp scene and the
              blurry one we saw with the 30s vertical sweep on 2026-05-23. */}
          <div className="border border-gold-soft bg-ivory-strong/30 px-4 py-3 flex flex-col gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              {labels.coachingTitle}
            </p>
            <ol className="text-xs text-ink/75 leading-relaxed list-decimal pl-4 flex flex-col gap-1">
              <li>{labels.tip1}</li>
              <li>{labels.tip2}</li>
              <li>{labels.tip3}</li>
              <li>{labels.tip4}</li>
            </ol>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
                {labels.fileLabel}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                name="video"
                accept="video/mp4,video/quicktime,video/webm"
                required
                disabled={isSubmitting}
                onChange={handleFileChange}
                className="text-sm text-ink file:mr-4 file:py-2 file:px-4 file:border file:border-gold-soft file:bg-ivory file:text-ink file:text-[10px] file:font-semibold file:uppercase file:tracking-[0.22em] file:cursor-pointer hover:file:border-gold disabled:opacity-50"
              />
            </label>

            {probing && (
              <p className="text-xs text-ink/55 italic">
                {labels.preflightReading}
              </p>
            )}

            {preflight && (
              <div
                className={`text-xs leading-relaxed px-3 py-2 border ${
                  hardFail
                    ? "border-red-300 bg-red-50 text-red-800"
                    : preflight.durationOk === "warn" ||
                        preflight.resolutionOk === "warn"
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-gold/40 bg-gold/5 text-ink"
                }`}
              >
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    {labels.durationLabel}: <strong>{fmtDuration(preflight.duration)}</strong>{" "}
                    {preflight.durationOk === "fail" && "✗"}
                    {preflight.durationOk === "warn" && "⚠"}
                    {preflight.durationOk === "ok" && "✓"}
                  </span>
                  <span>
                    {labels.resolutionLabel}:{" "}
                    <strong>
                      {preflight.width}×{preflight.height}
                    </strong>{" "}
                    {preflight.resolutionOk === "fail" && "✗"}
                    {preflight.resolutionOk === "warn" && "⚠"}
                    {preflight.resolutionOk === "ok" && "✓"}
                  </span>
                </div>
                {preflight.durationOk === "fail" && (
                  <p className="mt-1">
                    {labels.preflightTooShort
                      .replace("{duration}", fmtDuration(preflight.duration))}
                  </p>
                )}
                {preflight.resolutionOk === "fail" && (
                  <p className="mt-1">
                    {labels.preflightTooLow
                      .replace("{w}", String(preflight.width))
                      .replace("{h}", String(preflight.height))}
                  </p>
                )}
                {!hardFail &&
                  (preflight.durationOk === "warn" ||
                    preflight.resolutionOk === "warn") && (
                    <p className="mt-1">{labels.preflightWarn}</p>
                  )}
                {!hardFail &&
                  preflight.durationOk === "ok" &&
                  preflight.resolutionOk === "ok" && (
                    <p className="mt-1">{labels.preflightOk}</p>
                  )}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || probing || hardFail}
              className="self-start inline-flex items-center justify-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status === "ready" || status === "failed" || status === "expired"
                ? labels.replaceButton
                : labels.uploadButton}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
