import { describe, expect, it } from "vitest";
import { nextPreviewStateOnError, unplayableView, type PreviewViewState } from "@/lib/creative-studio/source-preview-view";

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
