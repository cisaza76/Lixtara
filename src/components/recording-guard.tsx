"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { gpcEnabled, needsFullLoad, readConsentState } from "@/lib/analytics-config";

// Clarity (desde GTM) graba la sesión y no tiene una función documentada para detenerse.
// El contenedor la excluye de /account (y /admin) en la CARGA de página, pero una navegación
// sin recarga (Link de Next, router.push, redirect() de una server action, atrás/adelante)
// la dejaría grabando. Decisión del owner (2026-10-16): toda entrada a /account es con carga
// completa, y toda salida de /account hacia el embudo también (con consentimiento), para
// que Clarity vuelva a cargarse. Lo mismo con la publicidad aceptada (2026-10-24): al entrar a
// una ruta sin publicidad y al salir de ella, para que GTM se cargue con las señales de esa
// ruta. Las rutas y la regla viven en analytics-config.

function consentGranted(): { analytics: boolean; ads: boolean } {
  const s = readConsentState(document.cookie);
  // Con Global Privacy Control la publicidad está denegada en todas partes: no hay que recargar por ella.
  return { analytics: s?.analytics === "granted", ads: s?.ads === "granted" && !gpcEnabled(navigator) };
}

export function RecordingGuard() {
  const pathname = usePathname();

  // Enlaces: se intercepta el clic antes que el Link de Next (fase de captura en document,
  // antes del listener de React) y se navega con carga completa.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (!needsFullLoad(window.location.pathname, url.pathname, consentGranted())) return;
      e.preventDefault();
      e.stopPropagation();
      window.location.assign(url.href);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Cualquier otra navegación sin recarga (router.push, redirect() de una server action como
  // el de /sign-in con next=/account, atrás/adelante): si cruzó el límite, se recarga la ruta
  // nueva. Nunca en el montaje (tras una carga completa no hay ruta anterior), así que no
  // hay bucle. Mientras tanto, /account va entera bajo data-clarity-mask (su layout).
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    if (from === null || from === pathname) return;
    if (needsFullLoad(from, pathname, consentGranted())) window.location.reload();
  }, [pathname]);

  return null;
}
