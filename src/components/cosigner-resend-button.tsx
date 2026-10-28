"use client";

// Paso 7 con dos vendedores (#220): reenvía la invitación al segundo firmante (el correo de
// DocuSign con el enlace y el de Lixtara) mientras el plazo no venció. POST /api/agreement/resend.

import { useState } from "react";

export interface CosignerResendLabels {
  button: string;
  sending: string;
  sent: string;
  failed: string;
  limit: string;
}

type State = "idle" | "sending" | "sent" | "failed" | "limit";

export function CosignerResendButton({ propertyId, labels }: { propertyId: string; labels: CosignerResendLabels }) {
  const [state, setState] = useState<State>("idle");

  async function resend() {
    setState("sending");
    try {
      const res = await fetch("/api/agreement/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ property_id: propertyId }),
      });
      setState(res.ok ? "sent" : res.status === 429 ? "limit" : "failed");
    } catch {
      setState("failed");
    }
  }

  const message = state === "sent" ? labels.sent : state === "failed" ? labels.failed : state === "limit" ? labels.limit : null;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={resend}
        disabled={state === "sending" || state === "sent"}
        className="self-start inline-flex items-center px-5 py-2.5 border border-gold-soft text-ink text-[10px] font-medium tracking-[0.2em] uppercase hover:border-gold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state === "sending" ? labels.sending : labels.button}
      </button>
      {message && (
        <p role="status" className={`text-sm leading-relaxed ${state === "sent" ? "text-ink/70" : "text-red-800"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
