// Condición 1 del cierre pre-merge de PR #117 (owner, 2026-08-05) — lógica PURA del
// fallback de previsualización del source. Vive fuera del componente porque la suite
// corre en entorno node (sin jsdom): igual que video-panel-model.ts, la decisión se
// testea aquí y el componente solo la renderiza.
//
// Regla: se conserva el retry ÚNICO ya existente (una renovación reactiva de la URL
// firmada, que es como se manifiesta una expiración). Si la reproducción vuelve a
// fallar, el navegador simplemente no puede con este contenedor: se deja de mostrar un
// player roto y se ofrece descargar el archivo con la URL firmada YA obtenida — sin
// pedir otra, sin polling, sin tocar nada operativo.

import { isAccessExpired, type TemporaryMediaAccess } from "@/lib/creative-studio/source-preview";

export type PreviewViewState = "idle" | "loading" | "playing" | "error" | "unplayable";

export interface PreviewErrorDecision {
  state: PreviewViewState;
  // true SOLO en el primer fallo: la renovación única preexistente.
  renewAccess: boolean;
}

export function nextPreviewStateOnError(input: { alreadyRetried: boolean; hasAccess: boolean }): PreviewErrorDecision {
  if (!input.alreadyRetried) {
    // Primer fallo: renovar una vez y seguir en reproducción (el <video> recarga con la
    // nueva URL). Comportamiento existente, intacto.
    return { state: "playing", renewAccess: true };
  }
  // Segundo fallo: no se renueva más. Con URL disponible ofrecemos descarga; sin ella,
  // el error genérico con reintento manual (nunca un CTA que no puede funcionar).
  return { state: input.hasAccess ? "unplayable" : "error", renewAccess: false };
}

export interface UnplayableCopy {
  unsupported: string;
  downloadCta: string;
}

export interface UnplayableView {
  message: string;
  cta: string;
  // La MISMA URL firmada que ya se obtuvo; null cuando no hay ninguna disponible.
  href: string | null;
}

export function unplayableView(copy: UnplayableCopy, locator: string | null): UnplayableView {
  return { message: copy.unsupported, cta: copy.downloadCta, href: locator ?? null };
}


// ---- Descarga del fallback: renovación BAJO DEMANDA (owner, 2026-08-05) --------------
// La URL firmada del preview es de vida corta. En vez de aceptar que el CTA caduque, el
// clic decide: si la que ya tenemos sigue vigente se usa tal cual (sin renovación
// innecesaria); si expiró o no hay, se pide UNA sola URL fresca y se descarga con ella.
// Nunca hay timers, polling ni renovación automática — solo la acción del vendedor.
// Never-throw: cualquier fallo (red, popup bloqueado) degrada a `failed`, y el estado
// operativo (source, Asset, job, grant, cuota, upload) queda intacto por construcción:
// esta función no conoce ninguno de ellos.

export interface DownloadAttemptInput {
  access: TemporaryMediaAccess | null;
  nowMs: number;
  // UN solo intento de renovación por clic; devuelve null si no se pudo.
  renew: () => Promise<TemporaryMediaAccess | null>;
  open: (href: string) => void;
}

export type DownloadOutcome = { status: "opened"; renewed: boolean } | { status: "failed" };

export async function runDownloadAttempt(input: DownloadAttemptInput): Promise<DownloadOutcome> {
  try {
    if (input.access && !isAccessExpired(input.access, input.nowMs)) {
      input.open(input.access.locator);
      return { status: "opened", renewed: false };
    }
    const fresh = await input.renew();
    if (!fresh) return { status: "failed" };
    input.open(fresh.locator);
    return { status: "opened", renewed: true };
  } catch {
    return { status: "failed" };
  }
}

// Candado de una sola solicitud en curso: un doble clic no dispara dos peticiones. No es
// una cola — el segundo clic simplemente se ignora ("busy") mientras el primero vive.
export function createSingleFlight(): {
  run: <T>(work: () => Promise<T>) => Promise<T | "busy">;
  isBusy: () => boolean;
} {
  let busy = false;
  return {
    isBusy: () => busy,
    async run<T>(work: () => Promise<T>): Promise<T | "busy"> {
      if (busy) return "busy";
      busy = true;
      try {
        return await work();
      } finally {
        busy = false;
      }
    },
  };
}
