"use client";

// Native form validation bubbles ("Please fill out this field.") are written
// in the BROWSER's language, not the page's: a Spanish browser on /en showed
// Spanish bubbles. Render this once on a page; it listens (capture phase, the
// `invalid` event does not bubble) for invalid fields anywhere in the document
// and swaps the browser's text for the page's. Renders nothing.

import { useEffect } from "react";

export interface ValidationLabels {
  valueMissing: string;
  checkboxMissing: string;
  radioMissing: string;
  selectMissing: string;
  fileMissing: string;
  email: string;
  pattern: string;
  /** template: "{min}" is replaced by the minimum length */
  tooShort: string;
  number: string;
  generic: string;
}

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isField(el: EventTarget | null): el is Field {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

function messageFor(el: Field, v: ValidityState, labels: ValidationLabels): string {
  const type = el instanceof HTMLInputElement ? el.type : "";
  if (v.valueMissing) {
    if (type === "checkbox") return labels.checkboxMissing;
    if (type === "radio") return labels.radioMissing;
    if (type === "file") return labels.fileMissing;
    if (el instanceof HTMLSelectElement) return labels.selectMissing;
    return labels.valueMissing;
  }
  if (v.typeMismatch && type === "email") return labels.email;
  if (v.patternMismatch) return labels.pattern;
  if (v.tooShort) {
    const min = el instanceof HTMLSelectElement ? 0 : el.minLength;
    return labels.tooShort.replace("{min}", String(min));
  }
  if (v.badInput || v.rangeUnderflow || v.rangeOverflow || v.stepMismatch) {
    return labels.number;
  }
  return labels.generic;
}

export function LocalizedValidation({ labels }: { labels: ValidationLabels }) {
  useEffect(() => {
    function onInvalid(e: Event) {
      const el = e.target;
      if (!isField(el)) return;
      // Clear first so a previous custom message doesn't mask the real state.
      el.setCustomValidity("");
      if (!el.validity.valid) el.setCustomValidity(messageFor(el, el.validity, labels));
    }
    // Any edit re-validates natively; our text comes back on the next submit.
    function onEdit(e: Event) {
      const el = e.target;
      if (!isField(el)) return;
      el.setCustomValidity("");
      // Radios share one validity: clear the whole group.
      if (el instanceof HTMLInputElement && el.type === "radio" && el.name && el.form) {
        const group = el.form.elements.namedItem(el.name);
        if (group instanceof RadioNodeList) {
          group.forEach((r) => {
            if (r instanceof HTMLInputElement) r.setCustomValidity("");
          });
        }
      }
    }
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
    };
  }, [labels]);

  return null;
}
