"use client";

// "Solicitar visita con Lixtara". Crea un lead para la broker; NO confirma la visita.
// Solo se pinta cuando el servidor lo permite (interruptor público o staff): ver
// canUseShowingRequests en src/lib/buyer-leads.server.ts. La ruta repite el control.

import { useState } from "react";
import { RESPONSE_SLA_HOURS } from "@/lib/buyer-leads";
import type { t } from "@/lib/i18n";

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
/** Los textos del diccionario, ya con {brokerFirstName} resuelto por el servidor. */
export type ShowingRequestLabels = Widen<ReturnType<typeof t>["showingRequest"]>;

type Target = { listingKey: string } | { propertyId: string };

const FIELD = "flex flex-col gap-1.5";
const LABEL = "text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/60";
const CONTROL =
  "w-full border border-gold-soft bg-ivory px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-gold";

export function ShowingRequestForm({
  target,
  lang,
  labels,
}: {
  target: Target;
  lang: "en" | "es";
  labels: ShowingRequestLabels;
}) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | "received" | "exclusive">(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, string | boolean> = {
      ...("listingKey" in target ? { listing_key: target.listingKey } : { property_id: target.propertyId }),
      full_name: String(fd.get("full_name") ?? ""),
      email: String(fd.get("email") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      preferred_times: String(fd.get("preferred_times") ?? ""),
      message: String(fd.get("message") ?? ""),
      other_agent_status: String(fd.get("other_agent_status") ?? ""),
      needs_to_sell: String(fd.get("needs_to_sell") ?? ""),
      consent_contact: fd.get("consent_contact") === "on",
      consent_marketing: fd.get("consent_marketing") === "on",
      website: String(fd.get("website") ?? ""),
      lang,
    };
    try {
      const res = await fetch("/api/showing-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; exclusive?: boolean; error?: string };
      if (res.ok && data.ok) {
        setDone(data.exclusive ? "exclusive" : "received");
        return;
      }
      const key = (data.error ?? "failed") as keyof ShowingRequestLabels["errors"];
      setError(labels.errors[key] ?? labels.errors.failed);
    } catch {
      setError(labels.errors.failed);
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="border border-gold bg-gold/5 p-5 flex flex-col gap-2">
        {done === "received" ? (
          <>
            <p className="font-display text-xl text-ink">{labels.successTitle}</p>
            <p className="text-sm text-ink/75">
              {labels.successBody.replace("{hours}", String(RESPONSE_SLA_HOURS))}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink/75">{labels.exclusiveBody}</p>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full px-6 py-4 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
      >
        {labels.button}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="border border-gold-soft p-5 flex flex-col gap-4" noValidate>
      <p className="text-sm text-ink/75">{labels.intro}</p>

      {/* Honeypot: invisible para personas. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

      <label className={FIELD}>
        <span className={LABEL}>{labels.fullName}</span>
        <input name="full_name" required maxLength={120} autoComplete="name" className={CONTROL} />
      </label>
      <label className={FIELD}>
        <span className={LABEL}>{labels.email}</span>
        <input name="email" type="email" required maxLength={200} autoComplete="email" className={CONTROL} />
      </label>
      <label className={FIELD}>
        <span className={LABEL}>{labels.phone}</span>
        <input name="phone" type="tel" maxLength={25} autoComplete="tel" className={CONTROL} />
      </label>
      <label className={FIELD}>
        <span className={LABEL}>{labels.preferredTimes}</span>
        <input name="preferred_times" maxLength={300} placeholder={labels.preferredTimesPlaceholder} className={CONTROL} />
      </label>
      <label className={FIELD}>
        <span className={LABEL}>{labels.message}</span>
        <textarea name="message" rows={3} maxLength={1000} className={CONTROL} />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className={`${LABEL} mb-1`}>{labels.otherAgentLabel}</legend>
        {(
          [
            ["exclusive", labels.otherAgentExclusive],
            ["non_exclusive", labels.otherAgentNonExclusive],
            ["none", labels.otherAgentNone],
            ["unsure", labels.otherAgentUnsure],
          ] as const
        ).map(([value, text]) => (
          <label key={value} className="flex items-center gap-2 text-sm text-ink/80">
            <input type="radio" name="other_agent_status" value={value} required />
            {text}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className={`${LABEL} mb-1`}>{labels.needsToSellLabel}</legend>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["yes", labels.needsToSellYes],
              ["no", labels.needsToSellNo],
              ["maybe", labels.needsToSellMaybe],
            ] as const
          ).map(([value, text]) => (
            <label key={value} className="flex items-center gap-2 text-sm text-ink/80">
              <input type="radio" name="needs_to_sell" value={value} />
              {text}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Consentimientos separados y sin preselección. Textos pendientes del abogado. */}
      <label className="flex items-start gap-2 text-xs text-ink/75">
        <input type="checkbox" name="consent_contact" required className="mt-0.5" />
        <span>{labels.consentContact}</span>
      </label>
      <label className="flex items-start gap-2 text-xs text-ink/75">
        <input type="checkbox" name="consent_marketing" className="mt-0.5" />
        <span>{labels.consentMarketing}</span>
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={sending}
        className="px-6 py-3.5 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors disabled:opacity-60"
      >
        {sending ? labels.sending : labels.submit}
      </button>
    </form>
  );
}
