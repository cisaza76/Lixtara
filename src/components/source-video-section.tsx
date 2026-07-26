"use client";

// F4.3 — Source Video management UI (read + upload + progress + replace). A THIN client
// consumer of the F4.1 two-phase upload contract + the F4.3 read endpoint; ALL orchestration
// lives in the tested pure module @/lib/creative-studio/source-upload-flow. This component
// never decides sourceStrategy, never builds storage paths, never streams the binary through
// Next.js (it uploads DIRECTLY to the signed URL), and never starts preparation/render.
// Delete is intentionally out of scope (deferred).
import { useEffect, useRef, useState } from "react";
import type { SellerSourceDto } from "@/lib/creative-studio/seller-source-status";
import { SourceVideoPreview, type SourceVideoPreviewCopy } from "@/components/source-video-preview";
import {
  runSourceUpload,
  validateLocalFile,
  SourceUploadError,
  type SourceUploadDeps,
  type SourceUploadPhase,
  type UploadProgress,
} from "@/lib/creative-studio/source-upload-flow";

export interface SourceVideoCopy {
  heading: string;
  emptyHint: string;
  uploadCta: string;
  replaceCta: string;
  statusPending: string; // e.g. "Video cargado · Pendiente de validación técnica"
  statusUploaded: string;
  uploadedOn: string;
  uploadingLabel: string;
  cancel: string;
  errorHeading: string;
  tryAgain: string;
  errInvalidType: string;
  errTooLarge: string;
  errEmpty: string;
  errGeneric: string;
  sr: { uploading: string; registered: string; error: string };
  preview: SourceVideoPreviewCopy;
}

const PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900";
const SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";
const SPINNER =
  "h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent motion-reduce:animate-none";

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
function formatDate(iso: string, lang: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", year: "numeric" }).format(d);
}

// Real API deps (fetch + direct XHR upload with progress/cancel). Injected so the pure flow
// stays testable; this component is a thin wiring layer (untested by vitest per repo convention).
function apiDeps(): SourceUploadDeps {
  return {
    async initiate(body) {
      const res = await fetch("/api/creative-studio/video/source/initiate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`initiate_${res.status}`);
      return res.json();
    },
    putSignedUrl(signedUrl, _token, file, opts) {
      return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signedUrl);
        xhr.setRequestHeader("content-type", file.type || "video/mp4");
        xhr.setRequestHeader("x-upsert", "false");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            opts.onProgress?.({ sentBytes: e.loaded, totalBytes: e.total, pct: Math.round((e.loaded / e.total) * 100) });
          }
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload_${xhr.status}`)));
        xhr.onerror = () => reject(new Error("upload_network_error"));
        xhr.onabort = () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        };
        opts.signal?.addEventListener("abort", () => xhr.abort());
        xhr.send(file as unknown as XMLHttpRequestBodyInit);
      });
    },
    async complete(body) {
      const res = await fetch("/api/creative-studio/video/source/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(`${j.error ?? "complete"}_${res.status}`); // status in message → retryable(503) detection
      }
      return res.json();
    },
  };
}

type View = "loading" | "ready" | "uploading" | "error";

export function SourceVideoSection({
  propertyId,
  lang,
  copy,
}: {
  propertyId: string;
  lang: string;
  copy: SourceVideoCopy;
}): React.JSX.Element {
  const [dto, setDto] = useState<SellerSourceDto | null>(null);
  const [view, setView] = useState<View>("loading");
  const [phase, setPhase] = useState<SourceUploadPhase | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function refetch(): Promise<void> {
    try {
      const res = await fetch(`/api/creative-studio/video/source?listingId=${encodeURIComponent(propertyId)}`);
      if (res.ok) setDto((await res.json()) as SellerSourceDto);
    } catch {
      /* keep prior */
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refetch().then(() => setView((v) => (v === "loading" ? "ready" : v)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  function localErrorText(code: string): string {
    return code === "invalid_mime" || code === "invalid_extension"
      ? copy.errInvalidType
      : code === "file_too_large"
        ? copy.errTooLarge
        : code === "empty_file"
          ? copy.errEmpty
          : copy.errGeneric;
  }

  async function onFile(file: File): Promise<void> {
    const local = validateLocalFile({ name: file.name, type: file.type, size: file.size });
    if (!local.ok) {
      setErrorMsg(localErrorText(local.error));
      setView("error");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setErrorMsg(null);
    setProgress({ sentBytes: 0, totalBytes: file.size, pct: 0 });
    setView("uploading");
    try {
      await runSourceUpload(apiDeps(), {
        listingId: propertyId,
        file: { name: file.name, type: file.type, size: file.size } as unknown as File,
        onPhase: setPhase,
        onProgress: setProgress,
        signal: controller.signal,
      });
      // Fail-safe replace: only NOW (registered) do we refresh to the new source.
      await refetch();
      setView("ready");
      setPhase(null);
    } catch (e) {
      if (e instanceof SourceUploadError && e.aborted) {
        setView("ready"); // cancelled before /complete — current source (if any) is intact
        setPhase(null);
        return;
      }
      // Backend/upload failures surface a generic seller message (never a technical detail).
      setErrorMsg(copy.errGeneric);
      setView("error");
    } finally {
      abortRef.current = null;
    }
  }

  const announce =
    view === "uploading" ? copy.sr.uploading : view === "error" ? copy.sr.error : dto?.exists ? copy.sr.registered : "";

  return (
    <section className="rounded-xl border border-neutral-200 p-6" aria-labelledby="source-video-heading">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <h3 id="source-video-heading" className="text-lg font-semibold">
        {copy.heading}
      </h3>

      <input
        ref={fileInput}
        type="file"
        accept="video/mp4"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onFile(f);
        }}
      />

      <div className="mt-4 flex flex-col gap-4">
        {view === "loading" ? (
          <div className="h-16 w-full animate-pulse rounded bg-neutral-100 motion-reduce:animate-none" />
        ) : view === "uploading" ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className={SPINNER} aria-hidden="true" />
              <span className="text-sm font-medium">{copy.uploadingLabel}</span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded bg-neutral-100"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress?.pct ?? 0}
              aria-label={copy.uploadingLabel}
            >
              <div className="h-full bg-neutral-900 transition-[width]" style={{ width: `${progress?.pct ?? 0}%` }} />
            </div>
            <p className="text-xs text-neutral-500">
              {progress ? `${progress.pct}% · ${formatBytes(progress.sentBytes)} / ${formatBytes(progress.totalBytes)}` : ""}
            </p>
            <div>
              <button type="button" className={SECONDARY} onClick={() => abortRef.current?.abort()} disabled={phase === "completing"}>
                {copy.cancel}
              </button>
            </div>
          </div>
        ) : dto?.exists && dto.source ? (
          <div className="flex flex-col gap-3">
            {/* F4.4 — inline preview of the current source (lazy, ephemeral access). */}
            <SourceVideoPreview propertyId={propertyId} copy={copy.preview} />
            <p className="text-sm">{dto.source.status === "pending_validation" ? copy.statusPending : copy.statusUploaded}</p>
            <p className="text-sm text-neutral-500">
              {copy.uploadedOn} {formatDate(dto.source.uploadedAt, lang)} · {formatBytes(dto.source.sizeBytes)}
            </p>
            <div>
              <button type="button" className={SECONDARY} onClick={() => fileInput.current?.click()}>
                {copy.replaceCta}
              </button>
            </div>
            {view === "error" && errorMsg ? (
              <p className="text-sm text-amber-700" role="alert">
                {errorMsg}
              </p>
            ) : null}
          </div>
        ) : view === "error" ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-sm" role="alert">
              <p className="font-medium">{copy.errorHeading}</p>
              <p className="mt-1">{errorMsg}</p>
            </div>
            <div>
              <button type="button" className={PRIMARY} onClick={() => fileInput.current?.click()}>
                {copy.tryAgain}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-neutral-500">{copy.emptyHint}</p>
            <div>
              <button type="button" className={PRIMARY} onClick={() => fileInput.current?.click()}>
                {copy.uploadCta}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
