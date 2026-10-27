"use client";

import { useEffect, useRef } from "react";

// Aviso de error que el servidor devuelve tras un envío (?error=…), con el scroll y el foco
// puestos en él al montarse. En móvil el botón de enviar queda lejos del aviso (paso 5: el
// botón está bajo la cuadrícula de fotos y el aviso arriba, junto al cargador); sin esto la
// persona no ve por qué no avanzó. Se monta de nuevo en cada intento (`key` en la página).
// data-step-notice: AppFormValidation lo oculta cuando un nuevo intento falla en el navegador.
export function FocusedErrorBanner({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    el.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      data-step-notice
      className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 focus:outline-none"
    >
      {message}
    </div>
  );
}
