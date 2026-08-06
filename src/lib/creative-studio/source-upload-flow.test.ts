import { describe, it, expect } from "vitest";
import {
  validateLocalFile,
  runSourceUpload,
  SourceUploadError,
  type SourceUploadDeps,
  type SourceUploadPhase,
  type LocalFile,
  createXhrPutSignedUrl,
} from "./source-upload-flow";
import { VIDEO_SOURCE_LIMITS } from "@/lib/video-engine/video-source-limits";

// El contrato exige un File real (con bytes): un descriptor plano ya no compila —
// esa era exactamente la puerta por la que entró el bug de "[object Object]".
const FILE_DESC: LocalFile = { name: "clip.mp4", type: "video/mp4", size: 10_000_000 };
const FILE = new File([new Uint8Array(10_000_000)], "clip.mp4", { type: "video/mp4" });
const withSize = (size: number, over: Partial<LocalFile> = {}) =>
  new File([new Uint8Array(size)], over.name ?? "clip.mp4", { type: over.type ?? "video/mp4" });

describe("validateLocalFile (preventive UX; backend is authority)", () => {
  it("accepts a valid mp4 under the limit", () => {
    expect(validateLocalFile(FILE_DESC)).toEqual({ ok: true });
  });
  // Etapa 1: MOV/QuickTime entra al set cerrado (autorizado 2026-08-05).
  it("acepta .mov/video/quicktime — el archivo tal como sale del iPhone", () => {
    expect(validateLocalFile({ ...FILE_DESC, type: "video/quicktime", name: "IMG_6371.MOV" })).toEqual({ ok: true });
  });
  it("rejects mime / extension outside the closed set / empty / oversized", () => {
    expect(validateLocalFile({ ...FILE_DESC, type: "video/webm" })).toEqual({ ok: false, error: "invalid_mime" });
    expect(validateLocalFile({ ...FILE_DESC, name: "clip.mkv" })).toEqual({ ok: false, error: "invalid_extension" });
    expect(validateLocalFile({ ...FILE_DESC, size: 0 })).toEqual({ ok: false, error: "empty_file" });
    expect(validateLocalFile({ ...FILE_DESC, size: VIDEO_SOURCE_LIMITS.maxFileBytes + 1 })).toEqual({ ok: false, error: "file_too_large" });
  });
});

function deps(over: Partial<SourceUploadDeps> = {}): SourceUploadDeps {
  return {
    initiate: over.initiate ?? (async () => ({ assetId: "a1", bucket: "creative-studio", storagePath: "source/O/L/a1/source.mp4", upload: { signedUrl: "https://signed/x", token: "tok" } })),
    putSignedUrl: over.putSignedUrl ?? (async () => {}),
    complete: over.complete ?? (async () => ({ assetId: "row-1", registered: true })),
  };
}

describe("runSourceUpload — happy path", () => {
  it("runs initiate → upload → complete and reports phases + progress", async () => {
    const phases: SourceUploadPhase[] = [];
    let lastPct = 0;
    const r = await runSourceUpload(
      deps({
        putSignedUrl: async (_u, _t, _f, o) => {
          o.onProgress?.({ sentBytes: 5_000_000, totalBytes: 10_000_000, pct: 50 });
          o.onProgress?.({ sentBytes: 10_000_000, totalBytes: 10_000_000, pct: 100 });
        },
      }),
      { listingId: "L", file: FILE, onPhase: (p) => phases.push(p), onProgress: (p) => (lastPct = p.pct) },
    );
    expect(r.assetId).toBe("row-1");
    expect(phases).toEqual(["validating", "initiating", "uploading", "completing", "registered"]);
    expect(lastPct).toBe(100);
  });
});

describe("runSourceUpload — failures", () => {
  it("local validation failure stops before initiate", async () => {
    let initiated = false;
    await expect(
      runSourceUpload(deps({ initiate: async () => { initiated = true; throw new Error("x"); } }), { listingId: "L", file: withSize(0) }),
    ).rejects.toMatchObject({ phase: "validating", message: "empty_file" });
    expect(initiated).toBe(false);
  });
  it("initiate failure", async () => {
    await expect(runSourceUpload(deps({ initiate: async () => { throw new Error("init boom"); } }), { listingId: "L", file: FILE })).rejects.toMatchObject({ phase: "initiating" });
  });
  it("upload failure", async () => {
    await expect(runSourceUpload(deps({ putSignedUrl: async () => { throw new Error("net"); } }), { listingId: "L", file: FILE })).rejects.toMatchObject({ phase: "uploading", aborted: false });
  });
  it("upload abort is flagged", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    await expect(runSourceUpload(deps({ putSignedUrl: async () => { throw err; } }), { listingId: "L", file: FILE })).rejects.toMatchObject({ phase: "uploading", aborted: true });
  });
  it("complete failure — 503/audit_not_ensured is retryable", async () => {
    try {
      await runSourceUpload(deps({ complete: async () => { throw new Error("audit_not_ensured (503)"); } }), { listingId: "L", file: FILE });
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SourceUploadError);
      expect((e as SourceUploadError).phase).toBe("completing");
      expect((e as SourceUploadError).retryable).toBe(true);
    }
  });
  it("complete failure — other errors are non-retryable", async () => {
    try {
      await runSourceUpload(deps({ complete: async () => { throw new Error("asset_create_failed"); } }), { listingId: "L", file: FILE });
      throw new Error("should throw");
    } catch (e) {
      expect((e as SourceUploadError).retryable).toBe(false);
    }
  });
});

// ---- BUG CRÍTICO (descubierto en revisión manual Safari, 2026-08-06) ------------------
// El componente sustituía el File real por un descriptor plano {name,type,size} casteado
// con `as unknown as File`; xhr.send() lo serializaba a "[object Object]" (15 bytes), así
// que NINGÚN upload desde navegador subía el video. Estas pruebas fijan el contrato:
// lo que viaja al PUT es el File/Blob REAL, con sus bytes.

const VIDEO_BYTES = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 1, 2, 3, 4, 5, 6, 7, 8]);
const movFile = () => new File([VIDEO_BYTES], "IMG_6371.MOV", { type: "video/quicktime" });
const mp4File = () => new File([VIDEO_BYTES], "clip.mp4", { type: "video/mp4" });

function capturingDeps(over: Partial<SourceUploadDeps> = {}) {
  const captured: { file?: unknown; completeCalls: number; order: string[] } = { completeCalls: 0, order: [] };
  const deps: SourceUploadDeps = {
    initiate: async () => {
      captured.order.push("initiate");
      return { assetId: "a1", bucket: "creative-studio", storagePath: "source/O/L/a1/source.mov", upload: { signedUrl: "https://signed/x", token: "tok" } };
    },
    putSignedUrl: async (_url, _token, file) => {
      captured.order.push("put");
      captured.file = file;
    },
    complete: async () => {
      captured.order.push("complete");
      captured.completeCalls += 1;
      return { assetId: "asset-1", uploadId: "a1", registered: true };
    },
    ...over,
  };
  return { deps, captured };
}

describe("El PUT recibe el File REAL, nunca un descriptor plano", () => {
  it("putSignedUrl recibe EXACTAMENTE el objeto File seleccionado (misma referencia)", async () => {
    const file = movFile();
    const { deps, captured } = capturingDeps();
    await runSourceUpload(deps, { listingId: "L", file });
    expect(captured.file).toBe(file);
  });

  it("el payload es un Blob/File real, no un objeto plano", async () => {
    const { deps, captured } = capturingDeps();
    await runSourceUpload(deps, { listingId: "L", file: movFile() });
    expect(captured.file).toBeInstanceOf(Blob);
    expect(captured.file).toBeInstanceOf(File);
  });

  it("los bytes enviados coinciden byte a byte con el original", async () => {
    const { deps, captured } = capturingDeps();
    await runSourceUpload(deps, { listingId: "L", file: movFile() });
    const sent = new Uint8Array(await (captured.file as Blob).arrayBuffer());
    expect(Array.from(sent)).toEqual(Array.from(VIDEO_BYTES));
  });

  it("name/type/size se preservan intactos", async () => {
    const { deps, captured } = capturingDeps();
    await runSourceUpload(deps, { listingId: "L", file: movFile() });
    const f = captured.file as File;
    expect({ name: f.name, type: f.type, size: f.size }).toEqual({
      name: "IMG_6371.MOV",
      type: "video/quicktime",
      size: VIDEO_BYTES.length,
    });
  });

  it("NUNCA se envía '[object Object]' (la firma exacta del bug)", async () => {
    const { deps, captured } = capturingDeps();
    await runSourceUpload(deps, { listingId: "L", file: movFile() });
    expect(String(captured.file)).not.toBe("[object Object]");
    const sent = new TextDecoder().decode(await (captured.file as Blob).arrayBuffer());
    expect(sent).not.toContain("[object Object]");
  });

  it("MP4 y MOV siguen exactamente el mismo camino", async () => {
    for (const f of [mp4File(), movFile()]) {
      const { deps, captured } = capturingDeps();
      await runSourceUpload(deps, { listingId: "L", file: f });
      expect(captured.file).toBe(f);
      expect(captured.order).toEqual(["initiate", "put", "complete"]);
    }
  });

  it("un fallo del PUT no registra el source ni reporta éxito", async () => {
    const { deps, captured } = capturingDeps({
      putSignedUrl: async () => {
        throw new Error("upload_500");
      },
    });
    await expect(runSourceUpload(deps, { listingId: "L", file: movFile() })).rejects.toBeInstanceOf(SourceUploadError);
    expect(captured.completeCalls).toBe(0);
    expect(captured.order).not.toContain("complete");
  });

  it("complete ocurre SOLO después de un PUT exitoso (orden estricto)", async () => {
    const { deps, captured } = capturingDeps();
    await runSourceUpload(deps, { listingId: "L", file: movFile() });
    expect(captured.order).toEqual(["initiate", "put", "complete"]);
  });
});

// ---- Integración browser-like: transporte XHR real con mock que captura el body --------
describe("createXhrPutSignedUrl — el transporte envía los bytes, no una cadena", () => {
  function fakeXhrFactory() {
    const calls: { body?: unknown; headers: Record<string, string>; url?: string } = { headers: {} };
    const xhr = {
      upload: {} as { onprogress?: (e: ProgressEvent) => void },
      status: 200,
      onload: undefined as undefined | (() => void),
      onerror: undefined as undefined | (() => void),
      onabort: undefined as undefined | (() => void),
      open(_m: string, url: string) {
        calls.url = url;
      },
      setRequestHeader(k: string, v: string) {
        calls.headers[k] = v;
      },
      send(body: unknown) {
        calls.body = body;
        queueMicrotask(() => xhr.onload?.());
      },
      abort() {},
    };
    return { xhr, calls };
  }

  it("el body recibido por xhr.send es el Blob con los bytes exactos", async () => {
    const { xhr, calls } = fakeXhrFactory();
    const file = movFile();
    await createXhrPutSignedUrl(() => xhr as unknown as XMLHttpRequest)("https://signed/x", "tok", file, {});
    expect(calls.body).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await (calls.body as Blob).arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(VIDEO_BYTES)); // byte-for-byte
    expect(calls.headers["content-type"]).toBe("video/quicktime");
  });

  it("un status de error rechaza y NO se interpreta como éxito", async () => {
    const { xhr } = fakeXhrFactory();
    xhr.status = 500;
    await expect(
      createXhrPutSignedUrl(() => xhr as unknown as XMLHttpRequest)("https://signed/x", "tok", movFile(), {}),
    ).rejects.toThrow(/upload_500/);
  });
});
