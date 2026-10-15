"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isRecordingExcludedPath } from "@/lib/analytics-config";

// Clarity (desde GTM) graba la sesión y no tiene una función documentada para detenerse.
// El contenedor la excluye de /listing, /account, /auth… en la CARGA de página, pero una
// navegación sin recarga (Link de Next, router.push, atrás/adelante) la dejaría grabando.
// Decisión del owner (2026-10-14, opción "a"): mientras Clarity esté activo, a esas rutas se
// entra con carga completa. Sin Clarity (sin consentimiento o etiqueta en pausa), nada cambia.

function clarityActive(): boolean {
  return typeof (window as unknown as { clarity?: unknown }).clarity === "function";
}

export function RecordingGuard() {
  const pathname = usePathname();

  // Enlaces: se intercepta el clic antes que el Link de Next (fase de captura en document,
  // antes del listener de React) y se navega con carga completa.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!clarityActive()) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || !isRecordingExcludedPath(url.pathname)) return;
      e.preventDefault();
      e.stopPropagation();
      window.location.assign(url.href);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Cualquier otra navegación sin recarga (router.push, redirect de una acción, atrás):
  // si llegó a una ruta excluida con Clarity cargado, se recarga para que no la grabe.
  // Nunca en el montaje: tras una carga completa Clarity aún no existe (y si el contenedor
  // la cargara igual en una ruta excluida, recargar al montar sería un bucle).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (isRecordingExcludedPath(pathname) && clarityActive()) window.location.reload();
  }, [pathname]);

  return null;
}
