// F4.3 — the client-side Source Video upload ORCHESTRATION as a pure, injectable state
// machine (no React, no real fetch/XHR here). The thin React component wires real
// collaborators; this module holds all the testable logic: local pre-validation, the
// initiate → direct-upload(progress) → complete sequence, cancellation, and the fail-safe
// replace contract (the caller keeps the current source until this resolves "registered";
// nothing here ever deletes). Local validation is PREVENTIVE UX only — the backend (F4.1)
// stays the authority and re-validates.
import { ALLOWED_SOURCE_MIME, ALLOWED_SOURCE_EXT } from "@/lib/creative-studio/source-upload";
import { VIDEO_SOURCE_LIMITS } from "@/lib/video-engine/video-source-limits";

export interface LocalFile {
  name: string;
  type: string;
  size: number;
}
export type LocalValidationError = "invalid_mime" | "invalid_extension" | "empty_file" | "file_too_large";

// Only what F4.1 actually accepts (video/mp4). Never announces MOV/HEVC.
export function validateLocalFile(file: LocalFile): { ok: true } | { ok: false; error: LocalValidationError } {
  if (!(ALLOWED_SOURCE_MIME as readonly string[]).includes(file.type)) return { ok: false, error: "invalid_mime" };
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!(ALLOWED_SOURCE_EXT as readonly string[]).includes(ext)) return { ok: false, error: "invalid_extension" };
  if (!(file.size > 0)) return { ok: false, error: "empty_file" };
  if (file.size > VIDEO_SOURCE_LIMITS.maxFileBytes) return { ok: false, error: "file_too_large" };
  return { ok: true };
}

export type SourceUploadPhase = "validating" | "initiating" | "uploading" | "completing" | "registered";

export interface UploadProgress {
  sentBytes: number;
  totalBytes: number;
  pct: number; // 0..100, integer
}

export interface InitiateResult {
  assetId: string;
  bucket: string;
  storagePath: string;
  upload: { signedUrl: string; token: string };
}
export interface CompleteResult {
  assetId: string;
  registered?: boolean;
  status?: string;
}

// Lo que el PUT necesita: un Blob REAL (con bytes) que además expone name/type/size —
// exactamente lo que es un `File` del navegador. Tiparlo así impide que un descriptor
// plano {name,type,size} vuelva a colarse sin un cast explícito: fue justo eso lo que
// convirtió cada upload en "[object Object]" (15 bytes) hasta 2026-08-06.
export type UploadableFile = Blob & { readonly name: string; readonly type: string; readonly size: number };

export interface SourceUploadDeps {
  initiate(body: { listingId: string; fileName: string; mimeType: string; sizeBytes: number }): Promise<InitiateResult>;
  putSignedUrl(
    signedUrl: string,
    token: string,
    file: UploadableFile,
    opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal },
  ): Promise<void>;
  complete(body: { listingId: string; assetId: string; storagePath: string }): Promise<CompleteResult>;
}

export class SourceUploadError extends Error {
  constructor(
    readonly phase: SourceUploadPhase,
    message: string,
    readonly retryable = false,
    readonly aborted = false,
  ) {
    super(message);
    this.name = "SourceUploadError";
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function isAbort(e: unknown): boolean {
  return (e instanceof Error && e.name === "AbortError") || /abort/i.test(msg(e));
}

export interface RunSourceUploadInput {
  listingId: string;
  file: UploadableFile;
  onPhase?: (p: SourceUploadPhase) => void;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
}

// initiate → direct upload (with progress) → complete. Throws a typed SourceUploadError with
// the failing phase; a 503/audit_not_ensured from /complete is `retryable` (the object is
// already uploaded — the caller can retry ONLY /complete without re-uploading).
export async function runSourceUpload(deps: SourceUploadDeps, input: RunSourceUploadInput): Promise<{ assetId: string }> {
  const { listingId, file } = input;

  input.onPhase?.("validating");
  const local = validateLocalFile(file);
  if (!local.ok) throw new SourceUploadError("validating", local.error);

  input.onPhase?.("initiating");
  let init: InitiateResult;
  try {
    init = await deps.initiate({ listingId, fileName: file.name, mimeType: file.type, sizeBytes: file.size });
  } catch (e) {
    throw new SourceUploadError("initiating", msg(e));
  }

  input.onPhase?.("uploading");
  try {
    await deps.putSignedUrl(init.upload.signedUrl, init.upload.token, file, {
      onProgress: input.onProgress,
      signal: input.signal,
    });
  } catch (e) {
    throw new SourceUploadError("uploading", isAbort(e) ? "aborted" : msg(e), false, isAbort(e));
  }

  input.onPhase?.("completing");
  let done: CompleteResult;
  try {
    done = await deps.complete({ listingId, assetId: init.assetId, storagePath: init.storagePath });
  } catch (e) {
    const retryable = /\b503\b|audit_not_ensured/.test(msg(e));
    throw new SourceUploadError("completing", msg(e), retryable);
  }

  input.onPhase?.("registered");
  return { assetId: done.assetId ?? init.assetId };
}


// Transporte real del PUT firmado. Vivía embebido en el componente (no testeable en la
// suite, que corre en node), y ahí el `xhr.send(file as unknown as XMLHttpRequestBodyInit)`
// aceptaba cualquier cosa. Extraído + inyectable: la prueba browser-like captura el body y
// verifica byte a byte que viaja el Blob, no una serialización.
export function createXhrPutSignedUrl(
  newXhr: () => XMLHttpRequest = () => new XMLHttpRequest(),
): SourceUploadDeps["putSignedUrl"] {
  return (signedUrl, _token, file, opts) =>
    new Promise<void>((resolve, reject) => {
      const xhr = newXhr();
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
      // El File ES un Blob: se envía tal cual, sin reconstruir, clonar ni serializar.
      xhr.send(file);
    });
}
