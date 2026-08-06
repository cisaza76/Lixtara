import { describe, expect, it } from "vitest";
import { announceFor, nextPreviewStateOnError, unplayableView, type PreviewViewState } from "@/lib/creative-studio/source-preview-view";

// Condición 1 (owner, 2026-08-05) — fallback estable cuando el navegador no puede
// reproducir el contenedor del source (p. ej. .mov en un navegador sin soporte).
// Regla: se conserva el retry único existente; el SEGUNDO fallo deja de mostrar un
// player roto y ofrece la descarga con la URL firmada YA obtenida (sin pedir otra).
describe("nextPreviewStateOnError — máquina de estados del error de reproducción", () => {
  it("primer fallo: renueva UNA vez (comportamiento existente), sin fallback", () => {
    const r = nextPreviewStateOnError({ alreadyRetried: false, hasAccess: true });
    expect(r).toEqual({ state: "playing", renewAccess: true });
  });

  it("segundo fallo con URL firmada disponible: fallback estable, SIN renovar", () => {
    const r = nextPreviewStateOnError({ alreadyRetried: true, hasAccess: true });
    expect(r).toEqual({ state: "unplayable", renewAccess: false });
  });

  it("segundo fallo SIN URL disponible: error genérico con reintento (no se ofrece descarga imposible)", () => {
    const r = nextPreviewStateOnError({ alreadyRetried: true, hasAccess: false });
    expect(r).toEqual({ state: "error", renewAccess: false });
  });

  it("nunca renueva más de una vez (no hay generación repetida de URLs ni polling)", () => {
    expect(nextPreviewStateOnError({ alreadyRetried: true, hasAccess: true }).renewAccess).toBe(false);
    expect(nextPreviewStateOnError({ alreadyRetried: true, hasAccess: false }).renewAccess).toBe(false);
  });

  it("es pura: devuelve SOLO estado de vista, ningún efecto operativo", () => {
    const r = nextPreviewStateOnError({ alreadyRetried: true, hasAccess: true });
    expect(Object.keys(r).sort()).toEqual(["renewAccess", "state"]);
    const allowed: PreviewViewState[] = ["idle", "loading", "playing", "error", "unplayable"];
    expect(allowed).toContain(r.state);
  });
});

describe("unplayableView — qué se muestra en el fallback", () => {
  const COPY = { unsupported: "This browser can't preview this video.", downloadCta: "Download video to preview" };
  const LOCATOR = "https://storage.example/sign/source.mov?token=abc";

  it("reutiliza EXACTAMENTE la URL firmada existente para la descarga", () => {
    const v = unplayableView(COPY, LOCATOR);
    expect(v.href).toBe(LOCATOR);
    expect(v.message).toBe(COPY.unsupported);
    expect(v.cta).toBe(COPY.downloadCta);
  });

  it("sin URL disponible no ofrece CTA (nunca un enlace muerto)", () => {
    expect(unplayableView(COPY, null).href).toBeNull();
  });

  it("no filtra detalle técnico: ni MIME, ni códec, ni bucket, ni error_code", () => {
    const v = unplayableView(COPY, LOCATOR);
    const text = `${v.message} ${v.cta}`.toLowerCase();
    for (const banned of ["quicktime", "video/", "mov", "codec", "h264", "hevc", "bucket", "error_code", "mime", "supabase", "storage"]) {
      expect(text, `filtra "${banned}"`).not.toContain(banned);
    }
  });
});

// ---- Ajuste final (owner, 2026-08-05): renovación bajo demanda SOLO al pulsar el CTA --
import { createSingleFlight, runDownloadAttempt } from "@/lib/creative-studio/source-preview-view";

const FRESH = { locator: "https://storage.example/fresh.mov?token=new", expiresAt: new Date(Date.now() + 300_000).toISOString() };
const STALE = { locator: "https://storage.example/stale.mov?token=old", expiresAt: new Date(Date.now() - 1000).toISOString() };
const NOW = Date.now();

describe("runDownloadAttempt — renovación bajo demanda al pulsar descargar", () => {
  it("URL VIGENTE: descarga directa, sin renovación innecesaria", async () => {
    let renews = 0;
    const opened: string[] = [];
    const r = await runDownloadAttempt({
      access: FRESH, nowMs: NOW,
      renew: async () => { renews++; return FRESH; },
      open: (h) => void opened.push(h),
    });
    expect(r).toEqual({ status: "opened", renewed: false });
    expect(renews).toBe(0);
    expect(opened).toEqual([FRESH.locator]);
  });

  it("URL EXPIRADA: obtiene una nueva al hacer clic y descarga con ella", async () => {
    const opened: string[] = [];
    let renews = 0;
    const r = await runDownloadAttempt({
      access: STALE, nowMs: NOW,
      renew: async () => { renews++; return FRESH; },
      open: (h) => void opened.push(h),
    });
    expect(r).toEqual({ status: "opened", renewed: true });
    expect(renews).toBe(1); // MÁXIMO un intento por clic
    expect(opened).toEqual([FRESH.locator]);
  });

  it("URL DESCONOCIDA (sin access): renueva una vez y descarga", async () => {
    const opened: string[] = [];
    const r = await runDownloadAttempt({ access: null, nowMs: NOW, renew: async () => FRESH, open: (h) => void opened.push(h) });
    expect(r).toEqual({ status: "opened", renewed: true });
    expect(opened).toEqual([FRESH.locator]);
  });

  it("renovación FALLIDA: estado estable, sin abrir nada, sin lanzar", async () => {
    const opened: string[] = [];
    const r = await runDownloadAttempt({ access: STALE, nowMs: NOW, renew: async () => null, open: (h) => void opened.push(h) });
    expect(r).toEqual({ status: "failed" });
    expect(opened).toEqual([]);
  });

  it("NEVER-THROW: un renew que explota degrada a failed", async () => {
    const r = await runDownloadAttempt({
      access: STALE, nowMs: NOW,
      renew: async () => { throw new Error("network down"); },
      open: () => {},
    });
    expect(r).toEqual({ status: "failed" });
  });

  it("NEVER-THROW: un open que explota degrada a failed", async () => {
    const r = await runDownloadAttempt({
      access: FRESH, nowMs: NOW, renew: async () => FRESH,
      open: () => { throw new Error("popup blocked"); },
    });
    expect(r).toEqual({ status: "failed" });
  });

  it("CERO efectos operativos: solo devuelve estado y usa las dependencias inyectadas", async () => {
    const r = await runDownloadAttempt({ access: FRESH, nowMs: NOW, renew: async () => FRESH, open: () => {} });
    expect(Object.keys(r).sort()).toEqual(["renewed", "status"]);
  });
});

describe("createSingleFlight — un doble clic no dispara dos solicitudes", () => {
  it("la segunda llamada concurrente devuelve 'busy' y el trabajo corre una sola vez", async () => {
    const flight = createSingleFlight();
    let runs = 0;
    let release: (v: string) => void = () => {};
    const work = () => { runs++; return new Promise<string>((res) => { release = res; }); };
    const first = flight.run(work);
    const second = await flight.run(work); // clic inmediato mientras el primero sigue
    expect(second).toBe("busy");
    expect(flight.isBusy()).toBe(true);
    release("done");
    expect(await first).toBe("done");
    expect(runs).toBe(1);
    expect(flight.isBusy()).toBe(false);
  });

  it("tras terminar, permite un nuevo intento manual", async () => {
    const flight = createSingleFlight();
    expect(await flight.run(async () => "a")).toBe("a");
    expect(await flight.run(async () => "b")).toBe("b");
  });

  it("libera el candado aunque el trabajo lance (never-throw del candado)", async () => {
    const flight = createSingleFlight();
    await expect(flight.run(async () => { throw new Error("x"); })).rejects.toThrow();
    expect(flight.isBusy()).toBe(false);
  });
});

describe("no-fuga y paridad del mensaje de fallo de descarga", () => {
  it("el copy de error de descarga no expone detalle técnico", () => {
    for (const msg of [
      "We couldn't prepare the download. Please try again.",
      "No pudimos preparar la descarga. Inténtalo de nuevo.",
    ]) {
      const t = msg.toLowerCase();
      for (const banned of ["url", "token", "403", "signed", "firmada", "bucket", "storage", "mime", "codec", "error_code"]) {
        expect(t, `filtra "${banned}"`).not.toContain(banned);
      }
    }
  });
});

describe("announceFor — accesibilidad sin texto duplicado", () => {
  const COPY = {
    unsupported: "This browser can't preview this video.",
    sr: { loading: "Loading video preview", playing: "Playing video preview", error: "Preview failed to load" },
  };
  it("en 'unplayable' NO duplica: el texto visible ya es role=status y lo anuncia solo", () => {
    expect(announceFor("unplayable", COPY)).toBe("");
  });
  it("los demás estados conservan su anuncio sr-only (sin regresión de accesibilidad)", () => {
    expect(announceFor("loading", COPY)).toBe(COPY.sr.loading);
    expect(announceFor("playing", COPY)).toBe(COPY.sr.playing);
    expect(announceFor("error", COPY)).toBe(COPY.sr.error);
    expect(announceFor("idle", COPY)).toBe("");
  });
});
