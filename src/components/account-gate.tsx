"use client";

// Deferred-registration gate shown at the signing step (7). The seller has
// built their whole listing on an anonymous session; here they create a real
// account so they can sign. Two states:
//   1. create  — name + email + password form (upgrades the anonymous user).
//   2. confirm — "check your email" while the confirmation is pending; polls
//      the session and advances automatically once the email is verified.
// Framed as "secure your listing", not "sign up" — the value is already built.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
  confirmWaiting: string;
  errName: string;
  errEmail: string;
  errPassword: string;
  errExists: string;
  errFailed: string;
}

interface AccountGateProps {
  registerAction: (formData: FormData) => Promise<void>;
  draftId: string;
  pendingEmail: string | null;
  error: string | null;
  labels: AccountGateLabels;
}

export function AccountGate({
  registerAction,
  draftId,
  pendingEmail,
  error,
  labels,
}: AccountGateProps) {
  if (pendingEmail) {
    return (
      <ConfirmEmail
        email={pendingEmail}
        eyebrow={labels.confirmEyebrow}
        title={labels.confirmTitle}
        body={labels.confirmBody}
        waiting={labels.confirmWaiting}
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
  eyebrow,
  title,
  body,
  waiting,
}: {
  email: string;
  eyebrow: string;
  title: string;
  body: string;
  waiting: string;
}) {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    const interval = setInterval(async () => {
      if (done.current) return;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      // Once the email is confirmed the anonymous user becomes permanent and
      // user.email is populated — refresh so the server renders the sign step.
      if (user?.email) {
        done.current = true;
        clearInterval(interval);
        router.refresh();
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [router]);

  return (
    <div className="flex flex-col gap-4 border border-gold bg-gold/5 p-6 lg:p-8">
      <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
        {eyebrow}
      </span>
      <h3 className="font-display text-2xl text-ink leading-tight">{title}</h3>
      <p className="text-base text-ink/80 leading-relaxed">
        {body} <span className="font-semibold text-ink">{email}</span>
      </p>
      <p
        className="inline-flex items-center gap-2 text-xs text-ink/55"
        aria-live="polite"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-gold" aria-hidden="true" />
        {waiting}
      </p>
    </div>
  );
}
