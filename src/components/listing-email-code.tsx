"use client";

// Step 1 of the listing flow, second half: the seller typed their email with
// the address and we sent them a 6-digit code. Confirming it is what lets us
// send a magic link back to the draft if they drop off later.

import { useState } from "react";

export interface ListingEmailCodeLabels {
  eyebrow: string;
  title: string;
  body: string;
  codeLabel: string;
  codeHint: string;
  submit: string;
  resendPrompt: string;
  resendCta: string;
  changeEmail: string;
  signIn: string;
  resent: string;
  errFormat: string;
  errInvalid: string;
  errExpired: string;
  errExists: string;
  errLimit: string;
  errSend: string;
  errFailed: string;
}

export function ListingEmailCode({
  email,
  draftId,
  verifyAction,
  resendAction,
  changeEmailHref,
  signInHref,
  error,
  resent,
  labels,
}: {
  email: string;
  draftId: string;
  verifyAction: (formData: FormData) => Promise<void>;
  resendAction: (formData: FormData) => Promise<void>;
  changeEmailHref: string;
  signInHref: string;
  error: string | null;
  resent: boolean;
  labels: ListingEmailCodeLabels;
}) {
  const [submitting, setSubmitting] = useState(false);

  const msg =
    error === "format"
      ? labels.errFormat
      : error === "invalid"
        ? labels.errInvalid
        : error === "expired"
          ? labels.errExpired
          : error === "exists"
            ? labels.errExists
            : error === "limit"
              ? labels.errLimit
              : error === "send"
                ? labels.errSend
                : error === "failed"
                  ? labels.errFailed
                  : null;

  return (
    <form
      action={verifyAction}
      onSubmit={() => setSubmitting(true)}
      className="flex flex-col gap-5 border border-gold bg-gold/5 p-6 lg:p-8"
    >
      <input type="hidden" name="id" value={draftId} />
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
          {labels.eyebrow}
        </span>
        <h3 className="font-display text-2xl text-ink leading-tight">{labels.title}</h3>
        <p className="text-base text-ink/80 leading-relaxed">
          {labels.body} <span className="font-semibold text-ink">{email}</span>
        </p>
      </div>

      {msg && (
        <p role="alert" className="border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          {msg}
          {error === "exists" && (
            <>
              {" "}
              <a href={signInHref} className="underline underline-offset-4">
                {labels.signIn}
              </a>
            </>
          )}
        </p>
      )}
      {resent && !msg && (
        <p role="status" className="text-sm text-ink/80">
          {labels.resent} <span className="font-semibold text-ink">{email}</span>
        </p>
      )}

      <label className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
          {labels.codeLabel}
        </span>
        <input
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
          autoFocus
          className="bg-ivory border-2 border-gold-soft focus:border-gold outline-none px-4 py-3 text-2xl text-ink text-center tracking-[0.5em] font-display"
        />
        <span className="text-xs text-ink/50">{labels.codeHint}</span>
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center justify-center px-8 py-4 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors disabled:opacity-50"
      >
        {labels.submit} →
      </button>

      <div className="flex flex-col gap-2 border-t border-gold-soft pt-4 text-sm text-ink/70">
        <p>
          {labels.resendPrompt}{" "}
          <button
            type="submit"
            formAction={resendAction}
            formNoValidate
            className="underline underline-offset-4 text-gold hover:text-ink transition-colors"
          >
            {labels.resendCta}
          </button>
        </p>
        <a href={changeEmailHref} className="underline underline-offset-4 text-gold hover:text-ink transition-colors self-start">
          {labels.changeEmail}
        </a>
      </div>
    </form>
  );
}
