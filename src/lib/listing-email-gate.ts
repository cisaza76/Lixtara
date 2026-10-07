// Email gate at the START of the seller listing flow (Phase B, owner decision
// 2026-10-02). The seller leaves their email in step 1 and confirms it with a
// 6-digit code; from then on we can always send them a magic link back to
// their draft if they drop off at any step.
//
// Pure helpers only (no DB, no network) so they are unit-testable. The server
// side lives in listing-email-gate.server.ts. The code is validated by
// public.email_verification_challenges, never by Supabase's own OTP: we store
// only HMAC-SHA256(pepper, challengeId + ":" + code).

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_LENGTH = 6;
export const CODE_TTL_MINUTES = 10;
/** Sends per user per hour (first send included). */
export const MAX_SENDS_PER_HOUR = 3;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length > 0 && email.length <= 320 && EMAIL_RE.test(email);
}

/** Uniform 6-digit code from the CSPRNG (leading zeros kept). */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

export function isCodeFormat(code: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);
}

/** Strips spaces/dashes people paste from the email ("123 456"). */
export function cleanCodeInput(raw: unknown): string {
  return String(raw ?? "").replace(/[\s-]+/g, "");
}

export function codeHmac(pepper: string, challengeId: string, code: string): string {
  if (!pepper) throw new Error("EMAIL_CODE_PEPPER not configured");
  return createHmac("sha256", pepper).update(`${challengeId}:${code}`).digest("hex");
}

/** Constant-time comparison of two hex HMACs. */
export function hmacMatches(expectedHex: string, actualHex: string): boolean {
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(actualHex, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Path the seller lands on after a magic link: their draft at its last step. */
export function resumePath(lang: string, propertyId: string | null, step: number | null): string {
  if (!propertyId) return `/${lang}/listing/new`;
  const s = step && step >= 2 && step <= 8 ? step : 2;
  return `/${lang}/listing/new?id=${encodeURIComponent(propertyId)}&step=${s}`;
}
