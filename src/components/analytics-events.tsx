"use client";

// Disparadores de eventos para páginas renderizadas en el servidor. No hacen nada sin
// consentimiento: track() lo comprueba (src/lib/analytics.ts).

import { useEffect } from "react";
import { track, type AnalyticsEvent } from "@/lib/analytics";

/** Emite un evento una vez al montar (p. ej. al ver resultados o abrir una ficha). */
export function TrackOnMount({ event }: { event: AnalyticsEvent }) {
  const key = JSON.stringify(event);
  useEffect(() => {
    // Sin esperar un frame: track() lee el consentimiento de la cookie si el banner aún no
    // montó, y retiene lo de PostHog mientras su SDK carga.
    track(JSON.parse(key) as AnalyticsEvent);
  }, [key]);
  return null;
}
