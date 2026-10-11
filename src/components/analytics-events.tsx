"use client";

// Disparadores de eventos para páginas renderizadas en el servidor. No hacen nada sin
// consentimiento: track() lo comprueba (src/lib/analytics.ts).

import { useEffect } from "react";
import { track, type AnalyticsEvent } from "@/lib/analytics";

/** Emite un evento una vez al montar (p. ej. al ver resultados o abrir una ficha). */
export function TrackOnMount({ event }: { event: AnalyticsEvent }) {
  const key = JSON.stringify(event);
  useEffect(() => {
    // El banner puede habilitar la analítica en el mismo ciclo: un frame de margen.
    const id = requestAnimationFrame(() => track(JSON.parse(key) as AnalyticsEvent));
    return () => cancelAnimationFrame(id);
  }, [key]);
  return null;
}
