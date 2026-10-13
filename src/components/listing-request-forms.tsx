"use client";

// Formularios del vendedor para un listing ya enviado (#134 retiro, #136 cambios). Envían
// a /api/listings/[id]/{change,withdrawal}-request; nunca escriben properties.
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CHANGEABLE_FIELDS,
  CHANGEABLE_FIELD_NAMES,
  type ChangeableField,
  type FieldValue,
} from "@/lib/listing-requests";
import {
  ENUM_LABELS,
  FIELD_LABELS,
  REQUESTS_COPY,
  type RequestsLang,
} from "@/lib/listing-requests-copy";

type Current = Partial<Record<ChangeableField, FieldValue>>;

const inputClass =
  "w-full border border-gold-soft bg-ivory px-3 py-2 text-sm text-ink focus:border-gold focus:outline-none";
const labelClass = "text-[10px] uppercase tracking-[0.18em] text-ink/60";
const buttonClass =
  "inline-flex items-center px-5 py-2.5 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors disabled:opacity-50";

function toInput(v: FieldValue | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; error?: string; field?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string; field?: string };
    return { ok: false, error: res.status === 429 ? "rate_limited" : data.error, field: data.field };
  } catch {
    return { ok: false };
  }
}

export function ListingChangeRequestForm({
  lang,
  propertyId,
  current,
}: {
  lang: RequestsLang;
  propertyId: string;
  current: Current;
}) {
  const copy = REQUESTS_COPY[lang];
  const labels = FIELD_LABELS[lang];
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      CHANGEABLE_FIELD_NAMES.map((f) => [
        f,
        CHANGEABLE_FIELDS[f].kind === "bool" ? current[f] === true : toInput(current[f]),
      ]),
    ),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Solo lo que el vendedor tocó; el servidor vuelve a comparar contra la base.
    const changes: Record<string, string | boolean | null> = {};
    for (const f of CHANGEABLE_FIELD_NAMES) {
      const spec = CHANGEABLE_FIELDS[f];
      const v = values[f];
      if (spec.kind === "bool") {
        if (v !== (current[f] === true)) changes[f] = v as boolean;
      } else if (v !== toInput(current[f])) {
        changes[f] = v === "" ? null : (v as string);
      }
    }
    if (Object.keys(changes).length === 0) {
      setMessage({ tone: "err", text: copy.errors.no_changes });
      return;
    }
    setBusy(true);
    const r = await post(`/api/listings/${propertyId}/change-request`, { changes, reason });
    setBusy(false);
    if (r.ok) {
      setMessage({ tone: "ok", text: copy.sent });
      router.refresh();
      return;
    }
    const errs = copy.errors as Record<string, string>;
    const text =
      r.error === "invalid_value" && r.field
        ? `${copy.errors.invalid_value} ${labels[r.field as ChangeableField] ?? r.field}`
        : (r.error && errs[r.error]) || copy.errors.generic;
    setMessage({ tone: "err", text });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <p className="text-sm text-ink/70">{copy.changeHelp}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {CHANGEABLE_FIELD_NAMES.map((f) => {
          const spec = CHANGEABLE_FIELDS[f];
          const id = `chg-${f}`;
          if (spec.kind === "bool") {
            return (
              <label key={f} htmlFor={id} className="flex items-center gap-2 text-sm text-ink">
                <input
                  id={id}
                  type="checkbox"
                  checked={values[f] === true}
                  onChange={(e) => setValues((s) => ({ ...s, [f]: e.target.checked }))}
                />
                {labels[f]}
              </label>
            );
          }
          const wide = f === "description" || f === "showing_instructions";
          return (
            <div key={f} className={`flex flex-col gap-1.5 ${wide ? "sm:col-span-2" : ""}`}>
              <label htmlFor={id} className={labelClass}>
                {labels[f]}
              </label>
              {spec.kind === "enum" ? (
                <select
                  id={id}
                  className={inputClass}
                  value={values[f] as string}
                  onChange={(e) => setValues((s) => ({ ...s, [f]: e.target.value }))}
                >
                  {"nullable" in spec && spec.nullable && <option value="">—</option>}
                  {spec.values.map((v) => (
                    <option key={v} value={v}>
                      {ENUM_LABELS[lang][v] ?? v}
                    </option>
                  ))}
                </select>
              ) : wide ? (
                <textarea
                  id={id}
                  rows={f === "description" ? 6 : 3}
                  maxLength={spec.kind === "text" ? spec.max : undefined}
                  className={inputClass}
                  value={values[f] as string}
                  onChange={(e) => setValues((s) => ({ ...s, [f]: e.target.value }))}
                />
              ) : (
                <input
                  id={id}
                  type={spec.kind === "text" ? "text" : "number"}
                  step={spec.kind === "number" ? spec.step : spec.kind === "int" ? 1 : undefined}
                  maxLength={spec.kind === "text" ? spec.max : undefined}
                  className={inputClass}
                  value={values[f] as string}
                  onChange={(e) => setValues((s) => ({ ...s, [f]: e.target.value }))}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="chg-reason" className={labelClass}>
          {copy.reason}
        </label>
        <textarea
          id="chg-reason"
          rows={2}
          maxLength={2000}
          className={inputClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {message && (
        <p className={`text-sm ${message.tone === "ok" ? "text-ink" : "text-red-700"}`} role="status">
          {message.text}
        </p>
      )}
      <button type="submit" disabled={busy} className={`${buttonClass} self-start`}>
        {copy.submitChange}
      </button>
    </form>
  );
}

export function ListingWithdrawalForm({ lang, propertyId }: { lang: RequestsLang; propertyId: string }) {
  const copy = REQUESTS_COPY[lang];
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    const r = await post(`/api/listings/${propertyId}/withdrawal-request`, { reason });
    setBusy(false);
    if (r.ok) {
      setMessage({ tone: "ok", text: copy.sent });
      router.refresh();
      return;
    }
    const errs = copy.errors as Record<string, string>;
    setMessage({ tone: "err", text: (r.error && errs[r.error]) || copy.errors.generic });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm text-ink/70">{copy.withdrawHelp}</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="wd-reason" className={labelClass}>
          {copy.reason}
        </label>
        <textarea
          id="wd-reason"
          rows={2}
          maxLength={2000}
          className={inputClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        {copy.withdrawConfirm}
      </label>
      {message && (
        <p className={`text-sm ${message.tone === "ok" ? "text-ink" : "text-red-700"}`} role="status">
          {message.text}
        </p>
      )}
      <button type="submit" disabled={busy || !confirmed} className={`${buttonClass} self-start`}>
        {copy.submitWithdrawal}
      </button>
    </form>
  );
}
