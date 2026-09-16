"use client";

// Deferred-registration gate shown at the signing step (7). The seller has
// built their whole listing on an anonymous session; here they create a real
// account so they can sign. Two states:
//   1. create  — name + email + password form (upgrades the anonymous user).
//   2. confirm — "check your email" while the confirmation is pending; polls
//      the session and advances automatically once the email is verified.
// Framed as "secure your listing", not "sign up" — the value is already built.

import { useEffect, useState } from "react";

interface AccountGateLabels {
  createEyebrow: string;
  createTitle: string;
  createBody: string;
  firstNameLabel: string;
  lastNameLabel: string;
  emailLabel: string;
  passwordLabel: string;
  passwordHint: string;
  submitLabel: string;
  showPassword: string;
  hidePassword: string;
  confirmEyebrow: string;
  confirmTitle: string;
  confirmBody: string;
  codeLabel: string;
  codeHint: string;
  codeSubmit: string;
  resendPrompt: string;
  resendCta: string;
  resendSending: string;
  /** Lleva {s} — se sustituye por los segundos restantes. */
  resendCooldown: string;
  resendDone: string;
  errResendLimit: string;
  errResendFailed: string;
  errName: string;
  errEmail: string;
  errPassword: string;
  errExists: string;
  errFailed: string;
  errCodeFormat: string;
  errCodeInvalid: string;
}

/** Segundos de espera entre reenvíos. El control real es el límite del servidor;
 *  esto evita que el usuario pulse dos veces creyendo que no pasó nada. */
const RESEND_COOLDOWN_SECONDS = 60;

interface AccountGateProps {
  registerAction: (formData: FormData) => Promise<void>;
  verifyAction: (formData: FormData) => Promise<void>;
  resendAction: (formData: FormData) => Promise<void>;
  draftId: string;
  pendingEmail: string | null;
  error: string | null;
  codeError: string | null;
  /** Epoch en segundos del último reenvío, propagado por la URL para que el
   *  enfriamiento sobreviva a la recarga que provoca el server action. */
  resentAt: number | null;
  labels: AccountGateLabels;
}

export function AccountGate({
  registerAction,
  verifyAction,
  resendAction,
  draftId,
  pendingEmail,
  error,
  codeError,
  resentAt,
  labels,
}: AccountGateProps) {
  if (pendingEmail) {
    return (
      <ConfirmEmail
        email={pendingEmail}
        verifyAction={verifyAction}
        resendAction={resendAction}
        draftId={draftId}
        codeError={codeError}
        resentAt={resentAt}
        labels={labels}
      />
    );
  }
  return (
    <CreateAccount
      registerAction={registerAction}
      draftId={draftId}
      error={error}
      labels={labels}
    />
  );
}

function errorMessage(error: string | null, labels: AccountGateLabels): string | null {
  switch (error) {
    case "name":
      return labels.errName;
    case "email":
      return labels.errEmail;
    case "password":
      return labels.errPassword;
    case "exists":
      return labels.errExists;
    case "failed":
      return labels.errFailed;
    default:
      return null;
  }
}

function CreateAccount({
  registerAction,
  draftId,
  error,
  labels,
}: {
  registerAction: (formData: FormData) => Promise<void>;
  draftId: string;
  error: string | null;
  labels: AccountGateLabels;
}) {
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const msg = errorMessage(error, labels);

  return (
    <form
      action={registerAction}
      onSubmit={() => setSubmitting(true)}
      className="flex flex-col gap-5 border border-gold-soft bg-ivory-strong/30 p-6 lg:p-8"
    >
      <input type="hidden" name="id" value={draftId} />
      <div className="flex flex-col gap-2">
        <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="1.5" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          {labels.createEyebrow}
        </span>
        <h3 className="font-display text-2xl text-ink leading-tight">
          {labels.createTitle}
        </h3>
        <p className="text-sm text-ink/70 leading-relaxed">{labels.createBody}</p>
      </div>

      {msg && (
        <p
          role="alert"
          className="border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800"
        >
          {msg}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {labels.firstNameLabel}
          </span>
          <input
            name="first_name"
            type="text"
            required
            autoComplete="given-name"
            className="bg-ivory border-2 border-gold-soft focus:border-gold outline-none px-4 py-3 text-base text-ink"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {labels.lastNameLabel}
          </span>
          <input
            name="last_name"
            type="text"
            required
            autoComplete="family-name"
            className="bg-ivory border-2 border-gold-soft focus:border-gold outline-none px-4 py-3 text-base text-ink"
          />
        </label>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
          {labels.emailLabel}
        </span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          className="bg-ivory border-2 border-gold-soft focus:border-gold outline-none px-4 py-3 text-base text-ink"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
          {labels.passwordLabel}
        </span>
        <div className="relative">
          <input
            name="password"
            type={showPw ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full bg-ivory border-2 border-gold-soft focus:border-gold outline-none px-4 py-3 pr-16 text-base text-ink"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/50 hover:text-gold"
          >
            {showPw ? labels.hidePassword : labels.showPassword}
          </button>
        </div>
        <span className="text-xs text-ink/50">{labels.passwordHint}</span>
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center justify-center px-8 py-4 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors disabled:opacity-50"
      >
        {labels.submitLabel} →
      </button>
    </form>
  );
}

function ConfirmEmail({
  email,
  verifyAction,
  resendAction,
  draftId,
  codeError,
  resentAt,
  labels,
}: {
  email: string;
  verifyAction: (formData: FormData) => Promise<void>;
  resendAction: (formData: FormData) => Promise<void>;
  draftId: string;
  codeError: string | null;
  resentAt: number | null;
  labels: AccountGateLabels;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // El enfriamiento se deriva del sello que viene en la URL, no de un estado
  // local: así sobrevive a la recarga que provoca el server action.
  useEffect(() => {
    if (!resentAt || Number.isNaN(resentAt)) return;
    const tick = () => {
      const queda = RESEND_COOLDOWN_SECONDS - (Math.floor(Date.now() / 1000) - resentAt);
      // Acotado por arriba: un sello en el futuro — reloj desfasado o URL
      // manipulada — no puede producir una espera absurda.
      setCooldown(Math.max(0, Math.min(queda, RESEND_COOLDOWN_SECONDS)));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [resentAt]);

  const msg =
    codeError === "format"
      ? labels.errCodeFormat
      : codeError === "invalid"
        ? labels.errCodeInvalid
        : codeError === "resend_limit"
          ? labels.errResendLimit
          : codeError === "resend_failed"
            ? labels.errResendFailed
            : null;

  // Solo se anuncia el reenvío exitoso: si hubo error, manda el mensaje de error.
  const reenviado = Boolean(resentAt) && !codeError;

  return (
    <form
      action={verifyAction}
      onSubmit={() => setSubmitting(true)}
      className="flex flex-col gap-5 border border-gold bg-gold/5 p-6 lg:p-8"
    >
      <input type="hidden" name="id" value={draftId} />
      <div className="flex flex-col gap-2">
        <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
          {labels.confirmEyebrow}
        </span>
        <h3 className="font-display text-2xl text-ink leading-tight">
          {labels.confirmTitle}
        </h3>
        <p className="text-base text-ink/80 leading-relaxed">
          {labels.confirmBody}{" "}
          <span className="font-semibold text-ink">{email}</span>
        </p>
      </div>

      {msg && (
        <p
          role="alert"
          className="border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800"
        >
          {msg}
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
          pattern="[0-9]{6}"
          maxLength={6}
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
        {labels.codeSubmit} →
      </button>

      {/* Reenvío. Va DENTRO de este form con formAction porque anidar <form> no
          es válido en HTML; formNoValidate evita que el campo `required` del
          código bloquee el envío cuando justamente no se tiene el código. */}
      <div className="flex flex-col gap-2 border-t border-gold-soft pt-4">
        {reenviado && (
          <p role="status" className="text-sm text-ink/80">
            {labels.resendDone}{" "}
            <span className="font-semibold text-ink">{email}</span>
          </p>
        )}
        <p className="text-sm text-ink/70">
          {labels.resendPrompt}{" "}
          <button
            type="submit"
            formAction={resendAction}
            formNoValidate
            onClick={() => setResending(true)}
            disabled={resending || cooldown > 0}
            className="underline underline-offset-4 text-gold hover:text-ink transition-colors disabled:no-underline disabled:text-ink/40 disabled:cursor-not-allowed"
          >
            {resending
              ? labels.resendSending
              : cooldown > 0
                ? labels.resendCooldown.replace("{s}", String(cooldown))
                : labels.resendCta}
          </button>
        </p>
      </div>
    </form>
  );
}
