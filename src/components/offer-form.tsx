"use client";

import { useState } from "react";
import Link from "next/link";

interface OfferFormProps {
  propertyId: string;
  lang: string;
  listPrice: number;
  /** When set, the form is replaced with a sign-in CTA. */
  signedIn: boolean;
  signInHref: string;
  /** When true, the user is the property owner — show a notice instead of the form. */
  isOwner: boolean;
  labels: {
    eyebrow: string;
    titleBefore: string;
    titleAccent: string;
    titleAfter: string;
    body: string;
    gateTitle: string;
    gateBody: string;
    gateCta: string;
    amountLabel: string;
    earnestLabel: string;
    financingLabel: string;
    financingCash: string;
    financingConventional: string;
    financingFha: string;
    financingVa: string;
    financingOther: string;
    closingLabel: string;
    expirationLabel: string;
    contingenciesLabel: string;
    contingencyInspection: string;
    contingencyAppraisal: string;
    contingencyFinancing: string;
    contingencyHomeSale: string;
    messageLabel: string;
    messagePlaceholder: string;
    submitButton: string;
    submittingNote: string;
    successTitle: string;
    successBody: string;
    successCta: string;
    failedNotice: string;
    ownPropertyNotice: string;
    requireAmount: string;
    requireFinancing: string;
  };
}

export function OfferForm({
  propertyId,
  lang,
  listPrice,
  signedIn,
  signInHref,
  isOwner,
  labels,
}: OfferFormProps) {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <div className="border border-gold-soft bg-ivory-strong/40 p-8 flex flex-col gap-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
          {labels.eyebrow}
        </p>
        <h2 className="font-display text-2xl text-ink font-normal">
          {labels.gateTitle}
        </h2>
        <p className="text-sm text-ink/70 leading-relaxed">{labels.gateBody}</p>
        <Link
          href={signInHref}
          className="self-start inline-flex items-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
        >
          {labels.gateCta}
        </Link>
      </div>
    );
  }

  if (isOwner) {
    return (
      <div className="border border-gold-soft bg-ivory-strong/40 p-6">
        <p className="text-sm text-ink/70 italic">{labels.ownPropertyNotice}</p>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="border border-gold bg-gold/5 p-6 flex flex-col gap-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
          {labels.eyebrow}
        </p>
        <h2 className="font-display text-2xl text-ink font-normal">
          {labels.successTitle}
        </h2>
        <p className="text-sm text-ink/80 leading-relaxed">{labels.successBody}</p>
        <Link
          href={`/${lang}/dashboard`}
          className="self-start inline-flex items-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
        >
          {labels.successCta}
        </Link>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStatus("submitting");

    const fd = new FormData(e.currentTarget);
    const amount = Number(fd.get("offer_amount"));
    const financing = String(fd.get("financing_type") ?? "");
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(labels.requireAmount);
      setStatus("idle");
      return;
    }
    if (!financing) {
      setError(labels.requireFinancing);
      setStatus("idle");
      return;
    }

    const earnestRaw = String(fd.get("earnest_deposit") ?? "").trim();
    const earnest = earnestRaw === "" ? null : Number(earnestRaw);
    const closing = String(fd.get("closing_date") ?? "").trim() || null;
    const expirationDate = String(fd.get("expiration_date") ?? "").trim();
    const expiration_at = expirationDate
      ? new Date(`${expirationDate}T23:59:59`).toISOString()
      : null;
    const contingencies = fd.getAll("contingencies").map((c) => String(c));
    const message = String(fd.get("message") ?? "").trim() || null;

    try {
      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_id: propertyId,
          offer_amount: amount,
          earnest_deposit: earnest,
          financing_type: financing,
          closing_date: closing,
          expiration_at,
          contingencies,
          message,
        }),
      });
      const data = (await res.json()) as { error?: string; offer_id?: string };
      if (!res.ok || !data.offer_id) {
        throw new Error(data.error ?? "failed");
      }
      setStatus("success");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : labels.failedNotice);
    }
  }

  const submitting = status === "submitting";

  return (
    <div className="border border-gold-soft p-6 lg:p-8 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
          {labels.eyebrow}
        </p>
        <h2 className="font-display text-2xl text-ink font-normal">
          {labels.titleBefore}
          <em className="italic text-gold">{labels.titleAccent}</em>
          {labels.titleAfter}
        </h2>
        <p className="text-sm text-ink/70 leading-relaxed">{labels.body}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <label className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {labels.amountLabel}
          </span>
          <input
            type="number"
            name="offer_amount"
            min="1"
            step="1000"
            required
            disabled={submitting}
            defaultValue={listPrice}
            className="border border-gold-soft px-3 py-2 text-base text-ink bg-ivory focus:outline-none focus:border-gold disabled:opacity-50"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {labels.earnestLabel}
          </span>
          <input
            type="number"
            name="earnest_deposit"
            min="0"
            step="100"
            disabled={submitting}
            placeholder="0"
            className="border border-gold-soft px-3 py-2 text-base text-ink bg-ivory focus:outline-none focus:border-gold disabled:opacity-50"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {labels.financingLabel}
          </span>
          <select
            name="financing_type"
            required
            disabled={submitting}
            defaultValue=""
            className="border border-gold-soft px-3 py-2 text-base text-ink bg-ivory focus:outline-none focus:border-gold disabled:opacity-50"
          >
            <option value="" disabled>
              —
            </option>
            <option value="cash">{labels.financingCash}</option>
            <option value="conventional">{labels.financingConventional}</option>
            <option value="fha">{labels.financingFha}</option>
            <option value="va">{labels.financingVa}</option>
            <option value="other">{labels.financingOther}</option>
          </select>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
              {labels.closingLabel}
            </span>
            <input
              type="date"
              name="closing_date"
              disabled={submitting}
              className="border border-gold-soft px-3 py-2 text-base text-ink bg-ivory focus:outline-none focus:border-gold disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
              {labels.expirationLabel}
            </span>
            <input
              type="date"
              name="expiration_date"
              disabled={submitting}
              className="border border-gold-soft px-3 py-2 text-base text-ink bg-ivory focus:outline-none focus:border-gold disabled:opacity-50"
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-2 border border-gold-soft p-4">
          <legend className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55 px-2">
            {labels.contingenciesLabel}
          </legend>
          {[
            ["inspection", labels.contingencyInspection],
            ["appraisal", labels.contingencyAppraisal],
            ["financing", labels.contingencyFinancing],
            ["home_sale", labels.contingencyHomeSale],
          ].map(([value, label]) => (
            <label key={value} className="flex items-center gap-3 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                name="contingencies"
                value={value}
                disabled={submitting}
                className="accent-gold w-4 h-4"
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {labels.messageLabel}
          </span>
          <textarea
            name="message"
            rows={3}
            maxLength={2000}
            disabled={submitting}
            placeholder={labels.messagePlaceholder}
            className="border border-gold-soft px-3 py-2 text-sm text-ink bg-ivory focus:outline-none focus:border-gold disabled:opacity-50 resize-y"
          />
        </label>

        {error && (
          <p className="text-xs italic text-red-700 font-mono break-all">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="self-start inline-flex items-center px-8 py-4 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? labels.submittingNote : labels.submitButton}
        </button>
      </form>
    </div>
  );
}
