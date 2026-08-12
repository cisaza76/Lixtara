// Normalización de imágenes ANTES de enviarlas al clasificador de visión.
//
// Incidente 2026-08-11: una foto de listing de 8160×6120 provocó un 400 del proveedor
// ("At least one of the image dimensions exceed max allowed size: 8000 pixels") que escapó
// como excepción no capturada desde /generate, antes de crear el creative_job. Las cámaras
// modernas superan 8000 px con normalidad, así que esto no era un caso extremo.
//
// La DECISIÓN de redimensionar es pura y vive aquí. El redimensionado real (sharp) vive en
// `normalizeImageForVision`, un adaptador delgado sobre esta decisión.

// Límite propio, deliberadamente POR DEBAJO del máximo del proveedor (8000 px), no igual:
// - absorbe diferencias de redondeo entre lo que mide sharp y lo que mide el proveedor;
// - deja margen si el proveedor endurece el límite;
// - 7000 px sigue siendo muchísimo más de lo que la clasificación de habitaciones necesita
//   (el modelo reduce internamente de todos modos).
export const MAX_VISION_IMAGE_DIMENSION = 7000;

export interface ImageDimensions {
  width: number;
  height: number;
}

export type VisionResizePlan =
  | { action: "passthrough" }
  | { action: "resize"; width: number; height: number };

function isUsableDimension(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/**
 * ¿Hay que reducir esta imagen antes de mandarla a visión?
 *
 * - Dentro del límite → `passthrough`: no se recodifica nada (evita trabajo y pérdida).
 * - Fuera del límite → `resize` preservando el aspect ratio, acotando la dimensión MAYOR.
 * - Dimensiones desconocidas (0 / NaN) → `resize`: si no sabemos cuánto mide, no la
 *   enviamos cruda. Fallar hacia el lado seguro.
 *
 * Nunca hace upscale: una imagen pequeña se deja intacta.
 */
export function planVisionResize(dims: ImageDimensions): VisionResizePlan {
  const { width, height } = dims;
  if (!isUsableDimension(width) || !isUsableDimension(height)) {
    // Sin dimensiones fiables, se fuerza el paso por el redimensionador, que acotará
    // lo que realmente encuentre.
    return { action: "resize", width: MAX_VISION_IMAGE_DIMENSION, height: MAX_VISION_IMAGE_DIMENSION };
  }

  const longest = Math.max(width, height);
  if (longest <= MAX_VISION_IMAGE_DIMENSION) return { action: "passthrough" };

  const scale = MAX_VISION_IMAGE_DIMENSION / longest;
  return {
    action: "resize",
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// ---------------------------------------------------------------------------------------
// Adaptador: aplica la decisión. I/O por puertos inyectados para que sea testeable sin red
// ni sharp real. NO hay puerto de escritura, a propósito: la copia normalizada vive en
// memoria y nunca toca Storage ni sustituye la foto del listing.
// ---------------------------------------------------------------------------------------

/** Techo de memoria por imagen. Por encima, se falla de forma controlada en vez de agotar RAM. */
export const MAX_VISION_FETCH_BYTES = 30 * 1024 * 1024;

export interface VisionImageDeps {
  /** Descarga acotada: debe lanzar si el recurso excede MAX_VISION_FETCH_BYTES. */
  fetchBytes(url: string): Promise<Uint8Array>;
  /** Dimensiones reales, ya con la orientación EXIF aplicada. */
  probe(bytes: Uint8Array): Promise<ImageDimensions>;
  /** Reduce a (width, height) devolviendo JPEG. */
  resize(bytes: Uint8Array, width: number, height: number): Promise<{ bytes: Uint8Array; width: number; height: number }>;
}

export type NormalizedVisionImage =
  | { kind: "url"; url: string }
  | { kind: "inline"; base64: string; mime: "image/jpeg"; width: number; height: number };

/**
 * Deja una imagen lista para el clasificador de visión.
 *
 * Dentro del límite → se devuelve la URL: el proveedor la descarga él mismo y nos ahorramos
 * recodificar y reenviar megabytes. Fuera del límite → se envía una copia reducida en línea.
 *
 * Hay que descargar para poder medir; por eso la descarga está acotada por bytes.
 */
export async function normalizeImageForVision(
  url: string,
  deps: VisionImageDeps,
): Promise<NormalizedVisionImage> {
  const bytes = await deps.fetchBytes(url); // lanza si excede el techo
  const dims = await deps.probe(bytes);
  const plan = planVisionResize(dims);
  if (plan.action === "passthrough") return { kind: "url", url };

  const out = await deps.resize(bytes, plan.width, plan.height);
  return {
    kind: "inline",
    base64: Buffer.from(out.bytes).toString("base64"),
    mime: "image/jpeg",
    width: out.width,
    height: out.height,
  };
}
