"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";

// Validación de la app en los formularios de /listing/new. Sin esto el navegador validaba
// por su cuenta (burbuja nativa, en el idioma del navegador): el envío nunca llegaba y
// `listing_step_error` no salía. Ahora el formulario es noValidate, este componente
// comprueba las mismas reglas (required, type, pattern, min/max) con checkValidity() ANTES
// de enviar, y si falla: no envía (nada de lo escrito se pierde), marca los campos, muestra
// el mensaje de la app y reporta listing_step_error con el NOMBRE del campo, nunca su valor.
//
// Va dentro del <form>. El servidor sigue validando todo por su cuenta.
export function AppFormValidation({
  step,
  lang,
  message,
}: {
  step: number;
  lang: string;
  /** Mensaje de la app (copy.stepErrors.required). */
  message: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    form.noValidate = true;

    const clear = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el.getAttribute("aria-invalid") === "true" && (el as HTMLInputElement).checkValidity?.()) {
        el.removeAttribute("aria-invalid");
        el.classList.remove("!border-red-700", "outline", "outline-red-700");
      }
    };

    const onSubmit = (e: SubmitEvent) => {
      // Botones secundarios que no deben validar (p. ej. "mejorar descripción") llevan formNoValidate.
      const submitter = e.submitter as HTMLButtonElement | HTMLInputElement | null;
      if (submitter?.formNoValidate) return;
      if (form.checkValidity()) {
        setShown(false);
        return;
      }
      // Antes que React: el action del servidor no se dispara.
      e.preventDefault();
      e.stopPropagation();
      const invalid = Array.from(form.elements).filter(
        (el): el is HTMLInputElement => "validity" in el && !(el as HTMLInputElement).validity.valid,
      );
      for (const el of invalid) {
        el.setAttribute("aria-invalid", "true");
        el.classList.add(el.type === "checkbox" || el.type === "radio" ? "outline" : "!border-red-700");
        if (el.type === "checkbox" || el.type === "radio") el.classList.add("outline-red-700");
      }
      setShown(true);
      invalid[0]?.focus();
      const field = invalid[0]?.name || "unknown";
      track({ event: "listing_step_error", step, field, lang });
    };

    form.addEventListener("submit", onSubmit);
    form.addEventListener("input", clear);
    form.addEventListener("change", clear);
    return () => {
      form.removeEventListener("submit", onSubmit);
      form.removeEventListener("input", clear);
      form.removeEventListener("change", clear);
    };
  }, [step, lang]);

  return (
    <span ref={anchor} className="contents">
      {shown && (
        <p role="alert" className="text-sm text-red-700 leading-relaxed">
          {message}
        </p>
      )}
    </span>
  );
}
