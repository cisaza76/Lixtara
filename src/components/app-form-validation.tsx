"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { messageFor, type ValidationLabels } from "@/components/localized-validation";

// Validación de la app en los formularios de /listing/new. Sin esto el navegador validaba
// por su cuenta (burbuja nativa, en el idioma del navegador): el envío nunca llegaba y
// `listing_step_error` no salía. Ahora el formulario es noValidate (también en el HTML del
// servidor, así no hay burbuja nativa antes de hidratar), este componente comprueba las
// mismas reglas (required, type, pattern, min/max) con checkValidity() ANTES de enviar, y
// si falla: no envía (nada de lo escrito se pierde), marca los campos, pone un mensaje
// específico bajo cada uno, lleva el scroll y el foco al primero, oculta los avisos del
// intento anterior ([data-step-notice], p. ej. "este correo ya tiene una cuenta") y reporta
// listing_step_error con el NOMBRE del campo, nunca su valor.
//
// Va dentro del <form>. El servidor sigue validando todo por su cuenta.

const ERROR_ATTR = "data-app-field-error";
const MARK_CLASSES = ["!border-red-700", "outline", "outline-red-700"];

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isControl(el: Element): el is Control {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  );
}

/**
 * Pone el mensaje junto al campo sin romper la grilla: al final de su <label> (que es una
 * columna) para textos y listas; tras la <label> para una casilla; tras el contenedor del
 * grupo para radios. Devuelve el elemento al que se lleva el scroll.
 */
function placeMessage(form: HTMLFormElement, el: Control, p: HTMLElement): Element {
  const label = el.closest("label");
  if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
    const radios = form.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`);
    const last = radios[radios.length - 1];
    let group: Element | null = el.parentElement;
    while (group && last && !group.contains(last)) group = group.parentElement;
    (group ?? el).after(p);
    return group ?? el;
  }
  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    (label ?? el).after(p);
    return label ?? el;
  }
  if (label) {
    label.append(p);
    return label;
  }
  el.after(p);
  return el;
}

function errorId(form: HTMLFormElement, name: string): string {
  return `${form.id || "listing-form"}-${name}-error`;
}

function unmark(el: Control) {
  el.removeAttribute("aria-invalid");
  el.removeAttribute("aria-describedby");
  el.classList.remove(...MARK_CLASSES);
}

function removeMessage(form: HTMLFormElement, name: string) {
  form.querySelector(`[${ERROR_ATTR}="${CSS.escape(name)}"]`)?.remove();
}

export function AppFormValidation({
  step,
  lang,
  message,
  labels,
  fieldMessages = {},
}: {
  step: number;
  lang: string;
  /** Resumen arriba del formulario (copy.stepErrors.checkMarked). */
  message: string;
  /** Textos por tipo de error, en el idioma de la página (copy.validation). */
  labels: ValidationLabels;
  /** Mensaje por campo cuando falta (copy.fieldErrors): "Ingresa la dirección". */
  fieldMessages?: Record<string, string>;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    form.noValidate = true;

    const clear = (e: Event) => {
      const el = e.target;
      if (!(el instanceof Element) || !isControl(el)) return;
      if (el.getAttribute("aria-invalid") !== "true" || !el.checkValidity()) return;
      // Radios: la validez es del grupo; se limpia el grupo entero.
      const group =
        el instanceof HTMLInputElement && el.type === "radio" && el.name
          ? Array.from(form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]`))
          : [el];
      group.forEach(unmark);
      if (el.name) removeMessage(form, el.name);
    };

    const onSubmit = (e: SubmitEvent) => {
      // Botones secundarios que no deben validar (p. ej. "mejorar descripción") llevan formNoValidate.
      const submitter = e.submitter as HTMLButtonElement | HTMLInputElement | null;
      if (submitter?.formNoValidate) return;

      // Lo del intento anterior se va antes de mostrar lo nuevo.
      form.querySelectorAll(`[${ERROR_ATTR}]`).forEach((n) => n.remove());
      Array.from(form.elements).filter(isControl).forEach(unmark);

      if (form.checkValidity()) {
        setShown(false);
        return;
      }
      // Antes que React: el action del servidor no se dispara.
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll<HTMLElement>("[data-step-notice]").forEach((n) => {
        n.hidden = true;
      });

      const invalid = Array.from(form.elements).filter(
        (el): el is Control => isControl(el) && !el.validity.valid,
      );
      const seen = new Set<string>();
      let scrollTo: Element | null = null;
      for (const el of invalid) {
        el.setAttribute("aria-invalid", "true");
        const box = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
        el.classList.add(...(box ? ["outline", "outline-red-700"] : ["!border-red-700"]));

        // Un mensaje por campo (un grupo de radios es un campo).
        const key = el.name || el.id;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const text = (el.validity.valueMissing && fieldMessages[el.name]) || messageFor(el, el.validity, labels);
        const p = document.createElement("p");
        p.setAttribute(ERROR_ATTR, key);
        p.id = errorId(form, key);
        p.className = "text-sm text-red-700 leading-relaxed";
        p.textContent = text;
        const where = placeMessage(form, el, p);
        if (!scrollTo) scrollTo = where;
        el.setAttribute("aria-describedby", p.id);
      }
      setShown(true);

      const first = invalid[0];
      if (first) {
        (scrollTo ?? first).scrollIntoView({ behavior: "smooth", block: "center" });
        first.focus({ preventScroll: true });
      }
      const field = first?.name || "unknown";
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
  }, [step, lang, labels, fieldMessages]);

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
