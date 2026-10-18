"use client";

// "Mark as published on the MLS" de la ficha del listing. Los requisitos que vienen de la base
// (aprobado, acuerdo, pago) llegan del servidor; el del número de MLS se marca al escribir un
// número con formato válido, con la misma regla que valida el servidor (parseMlsNumber), sin
// tener que guardarlo antes. La base vuelve a validar todo al marcar.

import { useState } from "react";
import { parseMlsNumber } from "@/lib/listing-mls-number";

export function MarkPublishedForm({
  action,
  defaultMlsNumber,
  active,
  agreementCompleted,
  planPaid,
}: {
  action: (formData: FormData) => Promise<void>;
  defaultMlsNumber: string | null;
  active: boolean;
  agreementCompleted: boolean;
  planPaid: boolean;
}) {
  const [mlsNumber, setMlsNumber] = useState(defaultMlsNumber ?? "");
  const mlsValid = parseMlsNumber(mlsNumber).ok;
  const ready = active && agreementCompleted && planPaid && mlsValid;
  const items: Array<[boolean, string]> = [
    [active, "Listing approved (active)"],
    [agreementCompleted, "Listing agreement completed (seller signed, broker countersigned)"],
    [planPaid, "Plan payment succeeded"],
    [mlsValid, "MLS number"],
  ];

  return (
    <>
      <ul className="text-xs text-ink/70 flex flex-col gap-1" aria-live="polite">
        {items.map(([ok, label]) => (
          <li key={label}>
            {ok ? "✓" : "✗"} {label}
          </li>
        ))}
      </ul>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">MLS number</span>
          <input
            name="mls_number"
            type="text"
            required
            autoComplete="off"
            spellCheck={false}
            value={mlsNumber}
            onChange={(e) => setMlsNumber(e.target.value)}
            placeholder="A11234567"
            className="w-44 border border-gold-soft bg-ivory px-3 py-2 text-sm text-ink uppercase font-mono focus:outline-none focus:border-gold"
          />
        </label>
        <button
          type="submit"
          disabled={!ready}
          className="inline-flex items-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Mark as published on the MLS
        </button>
      </form>
    </>
  );
}
