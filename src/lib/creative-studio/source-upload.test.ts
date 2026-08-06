import { describe, it, expect } from "vitest";
import {
  buildSourceStoragePath,
  isExpectedSourcePath,
  validateInitiate,
  validateStoredObject,
  sourceAssetIdentity,
  isUuid,
  SOURCE_BUCKET,
  ALLOWED_SOURCE_MIME,
  ALLOWED_SOURCE_EXT,
  sourceExtFromFileName,
  mimeForSourceExt,
} from "./source-upload";
import { VIDEO_SOURCE_LIMITS } from "@/lib/video-engine/video-source-limits";

const OWNER = "11111111-1111-1111-1111-111111111111";
const LISTING = "22222222-2222-2222-2222-222222222222";
const ASSET = "33333333-3333-3333-3333-333333333333";

describe("bucket + path namespace (server-owned)", () => {
  it("uses the shared creative-studio bucket with a source/ prefix", () => {
    expect(SOURCE_BUCKET).toBe("creative-studio");
    expect(buildSourceStoragePath(OWNER, LISTING, ASSET)).toBe(`source/${OWNER}/${LISTING}/${ASSET}/source.mp4`);
  });
});

describe("validateInitiate (cheap gate — no ffmpeg)", () => {
  const base = { listingId: LISTING, fileName: "clip.mp4", mimeType: "video/mp4", sizeBytes: 10_000_000 };
  it("accepts a valid mp4 under the limit", () => {
    expect(validateInitiate(base)).toEqual({ ok: true });
  });
  // Etapa 1: el set pasó de {mp4} a {mp4, mov} (contrato ampliado, autorizado
  // 2026-08-05). La intención del test se conserva: NADA fuera del set cerrado entra.
  it("only accepts the closed MIME set (no generic video support)", () => {
    expect(ALLOWED_SOURCE_MIME).toEqual(["video/mp4", "video/quicktime"]);
    expect(validateInitiate({ ...base, mimeType: "video/webm" })).toEqual({ ok: false, error: "invalid_mime" });
    expect(validateInitiate({ ...base, mimeType: "video/x-matroska" }).ok).toBe(false);
  });
  it("rejects an extension outside the closed set", () => {
    expect(validateInitiate({ ...base, fileName: "clip.mkv" })).toEqual({ ok: false, error: "invalid_extension" });
  });
  it("rejects empty + oversized + missing size", () => {
    expect(validateInitiate({ ...base, sizeBytes: 0 })).toEqual({ ok: false, error: "empty_file" });
    expect(validateInitiate({ ...base, sizeBytes: VIDEO_SOURCE_LIMITS.maxFileBytes + 1 })).toEqual({ ok: false, error: "file_too_large" });
    expect(validateInitiate({ ...base, sizeBytes: undefined }).ok).toBe(false);
    // exactly at the cap is OK
    expect(validateInitiate({ ...base, sizeBytes: VIDEO_SOURCE_LIMITS.maxFileBytes })).toEqual({ ok: true });
  });
  it("rejects a missing/invalid listingId", () => {
    expect(validateInitiate({ ...base, listingId: undefined })).toEqual({ ok: false, error: "listing_id_required" });
    expect(validateInitiate({ ...base, listingId: "not-a-uuid" }).ok).toBe(false);
  });
});

describe("isExpectedSourcePath (path security)", () => {
  const good = buildSourceStoragePath(OWNER, LISTING, ASSET);
  it("accepts the exact server namespace", () => {
    expect(isExpectedSourcePath(good, OWNER, LISTING, ASSET)).toBe(true);
  });
  it("rejects traversal / null bytes", () => {
    expect(isExpectedSourcePath(`source/${OWNER}/${LISTING}/../evil/source.mp4`, OWNER, LISTING, ASSET)).toBe(false);
    expect(isExpectedSourcePath(good + "\0", OWNER, LISTING, ASSET)).toBe(false);
  });
  it("rejects another owner / listing / asset id", () => {
    const other = "99999999-9999-9999-9999-999999999999";
    expect(isExpectedSourcePath(buildSourceStoragePath(other, LISTING, ASSET), OWNER, LISTING, ASSET)).toBe(false);
    expect(isExpectedSourcePath(buildSourceStoragePath(OWNER, other, ASSET), OWNER, LISTING, ASSET)).toBe(false);
    expect(isExpectedSourcePath(buildSourceStoragePath(OWNER, LISTING, other), OWNER, LISTING, ASSET)).toBe(false);
  });
  it("rejects an arbitrary bucket-looking prefix", () => {
    expect(isExpectedSourcePath(`other-bucket/${OWNER}/${LISTING}/${ASSET}/source.mp4`, OWNER, LISTING, ASSET)).toBe(false);
    expect(isExpectedSourcePath(good, OWNER, LISTING, ASSET)).toBe(true);
  });
});

describe("validateStoredObject (real stored metadata, never client)", () => {
  it("accepts a present mp4 within the limit", () => {
    expect(validateStoredObject({ exists: true, sizeBytes: 5_000_000, mimeType: "video/mp4" })).toEqual({ ok: true });
  });
  it("missing object → object_not_found", () => {
    expect(validateStoredObject({ exists: false, sizeBytes: 0, mimeType: null })).toEqual({ ok: false, error: "object_not_found" });
  });
  it("empty / oversized / wrong mime rejected", () => {
    expect(validateStoredObject({ exists: true, sizeBytes: 0, mimeType: "video/mp4" })).toEqual({ ok: false, error: "empty_file" });
    expect(validateStoredObject({ exists: true, sizeBytes: VIDEO_SOURCE_LIMITS.maxFileBytes + 1, mimeType: "video/mp4" })).toEqual({ ok: false, error: "file_too_large" });
    expect(validateStoredObject({ exists: true, sizeBytes: 10, mimeType: "video/webm" })).toEqual({ ok: false, error: "invalid_mime" });
  });
});

describe("idempotency identity + uuid", () => {
  it("keys on (seller_upload, uploadId)", () => {
    expect(sourceAssetIdentity(ASSET)).toEqual({ sourceType: "seller_upload", sourceId: ASSET });
  });
  it("uuid guard", () => {
    expect(isUuid(ASSET)).toBe(true);
    expect(isUuid("nope")).toBe(false);
    expect(isUuid(123)).toBe(false);
  });
});

// ---- Etapa 1 — soporte MOV/H.264 SDR (autorizado 2026-08-05) -----------------------
// Los archivos que salen del iPhone son .mov; ffprobe sigue siendo la autoridad real
// (el MIME/extensión son solo un filtro barato de primera línea).

describe("Etapa 1 — MOV aceptado en la capa de ingesta", () => {
  it("acepta los dos MIME de entrada y ninguno más", () => {
    expect([...ALLOWED_SOURCE_MIME].sort()).toEqual(["video/mp4", "video/quicktime"]);
  });

  it("acepta las dos extensiones y ninguna más", () => {
    expect([...ALLOWED_SOURCE_EXT].sort()).toEqual(["mov", "mp4"]);
  });

  it("validateInitiate acepta un .mov con video/quicktime", () => {
    expect(
      validateInitiate({ listingId: LISTING, fileName: "IMG_6371.MOV", mimeType: "video/quicktime", sizeBytes: 48_412_268 }),
    ).toEqual({ ok: true });
  });

  it("validateInitiate sigue rechazando formatos fuera del set (webm, avi)", () => {
    expect(validateInitiate({ listingId: LISTING, fileName: "c.webm", mimeType: "video/webm", sizeBytes: 1000 })).toEqual({
      ok: false,
      error: "invalid_mime",
    });
    expect(validateInitiate({ listingId: LISTING, fileName: "c.avi", mimeType: "video/mp4", sizeBytes: 1000 })).toEqual({
      ok: false,
      error: "invalid_extension",
    });
  });

  it("el path NUNCA etiqueta falsamente el contenedor: .mov se guarda como source.mov", () => {
    expect(buildSourceStoragePath(OWNER, LISTING, ASSET, "mov")).toBe(`source/${OWNER}/${LISTING}/${ASSET}/source.mov`);
    expect(buildSourceStoragePath(OWNER, LISTING, ASSET, "mp4")).toBe(`source/${OWNER}/${LISTING}/${ASSET}/source.mp4`);
    // compatibilidad: sin extensión explícita sigue siendo mp4 (comportamiento previo)
    expect(buildSourceStoragePath(OWNER, LISTING, ASSET)).toBe(`source/${OWNER}/${LISTING}/${ASSET}/source.mp4`);
  });

  it("isExpectedSourcePath acepta AMBOS paths server-built y rechaza cualquier otro", () => {
    expect(isExpectedSourcePath(`source/${OWNER}/${LISTING}/${ASSET}/source.mov`, OWNER, LISTING, ASSET)).toBe(true);
    expect(isExpectedSourcePath(`source/${OWNER}/${LISTING}/${ASSET}/source.mp4`, OWNER, LISTING, ASSET)).toBe(true);
    // el cliente no puede elegir el nombre: nada fuera del set cerrado pasa
    expect(isExpectedSourcePath(`source/${OWNER}/${LISTING}/${ASSET}/source.exe`, OWNER, LISTING, ASSET)).toBe(false);
    expect(isExpectedSourcePath(`source/${OWNER}/${LISTING}/${ASSET}/../../x.mp4`, OWNER, LISTING, ASSET)).toBe(false);
  });

  it("sourceExtFromFileName normaliza mayúsculas (IMG_6371.MOV) y rechaza lo desconocido", () => {
    expect(sourceExtFromFileName("IMG_6371.MOV")).toBe("mov");
    expect(sourceExtFromFileName("clip.mp4")).toBe("mp4");
    expect(sourceExtFromFileName("clip.MP4")).toBe("mp4");
    expect(sourceExtFromFileName("clip.webm")).toBeNull();
    expect(sourceExtFromFileName("sinextension")).toBeNull();
  });

  it("mimeForSourceExt da el content-type correcto para el PUT firmado", () => {
    expect(mimeForSourceExt("mov")).toBe("video/quicktime");
    expect(mimeForSourceExt("mp4")).toBe("video/mp4");
  });

  it("validateStoredObject acepta el objeto real subido como video/quicktime", () => {
    expect(validateStoredObject({ exists: true, sizeBytes: 48_412_268, mimeType: "video/quicktime" })).toEqual({ ok: true });
    expect(validateStoredObject({ exists: true, sizeBytes: 1000, mimeType: "video/webm" })).toEqual({
      ok: false,
      error: "invalid_mime",
    });
  });
});
