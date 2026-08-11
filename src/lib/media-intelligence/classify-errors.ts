// Clasificación de fallos del clasificador de visión.
//
// Regla que este módulo existe para garantizar: NINGÚN fallo del proveedor puede escapar
// como una excepción 500 genérica. Cada uno se traduce a un tipo cerrado y, sobre todo, a
// una respuesta honesta a la pregunta "¿reintentar sirve de algo?".
//
// El incidente 2026-08-11 mostró por qué importa: el fallo era determinístico (una foto de
// 8160×6120 que siempre iba a ser rechazada) y la UI decía "trying again usually works".
//
// Este módulo NO propaga detalles del proveedor: ni su nombre, ni el modelo, ni el
// request_id, ni el cuerpo crudo. Solo el tipo y la retryabilidad.

export const VISION_FAILURE_KINDS = [
  "image_too_large", // determinístico: la imagen de origen no cumple los límites
  "provider_rejected", // determinístico: 4xx distinto de dimensiones
  "provider_unavailable", // transitorio: 429, 5xx, timeout, red
  "invalid_response", // determinístico: la respuesta no valida contra el esquema
  "unknown", // sin evidencia suficiente → se trata como determinístico
] as const;

export type VisionFailureKind = (typeof VISION_FAILURE_KINDS)[number];

export interface VisionFailure {
  kind: VisionFailureKind;
  /** ¿Tiene sentido reintentar SIN que cambie nada del input? */
  retryable: boolean;
}

const DIMENSION_HINT = /image dimensions exceed max allowed size|exceed max allowed size:\s*\d+\s*pixels/i;
const NETWORK_HINT = /fetch failed|network|ECONNRESET|ENOTFOUND|socket hang up/i;
const TIMEOUT_HINT = /timeout|timed out|aborted/i;

function textOf(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  const e = err as { message?: unknown; responseBody?: unknown; name?: unknown };
  return [e.name, e.message, e.responseBody].filter((v) => typeof v === "string").join(" ");
}

function statusOf(err: unknown): number | null {
  const e = err as { statusCode?: unknown; status?: unknown } | null;
  const raw = e?.statusCode ?? e?.status;
  return typeof raw === "number" ? raw : null;
}

export function classifyVisionFailure(err: unknown): VisionFailure {
  const text = textOf(err);
  const status = statusOf(err);
  const name = (err as { name?: unknown } | null)?.name;

  // 1. Dimensiones: determinístico y accionable por el vendedor. Se comprueba ANTES del
  //    status porque es el caso que motivó este módulo y llega como un 400 corriente.
  if (DIMENSION_HINT.test(text)) return { kind: "image_too_large", retryable: false };

  // 2. Esquema: el proveedor respondió, pero con una forma que no podemos consumir.
  if (name === "ZodError" || /validation error/i.test(text)) {
    return { kind: "invalid_response", retryable: false };
  }

  // 3. Transitorios explícitos por status.
  if (status === 429 || (status !== null && status >= 500)) {
    return { kind: "provider_unavailable", retryable: true };
  }

  // 4. Red y tiempo de espera: transitorios aunque no traigan status.
  if (name === "AbortError" || NETWORK_HINT.test(text) || TIMEOUT_HINT.test(text)) {
    return { kind: "provider_unavailable", retryable: true };
  }

  // 5. Resto de 4xx: el proveedor rechazó la petición; repetirla igual no cambia nada.
  if (status !== null && status >= 400) return { kind: "provider_rejected", retryable: false };

  // 6. Sin evidencia. Se trata como determinístico a propósito: prometer que reintentar
  //    funciona cuando no lo sabemos es exactamente el defecto que se está corrigiendo.
  return { kind: "unknown", retryable: false };
}
