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
