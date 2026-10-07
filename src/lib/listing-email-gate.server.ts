// Server side of the step-1 email gate (see listing-email-gate.ts for the why).
//
// Every write goes through the secret-key client: the three Phase B tables have
// no user-facing write policies (migration 20261003004631), so a seller can't
// forge their attempt counter or attach an email to someone else's draft.
//
// Flow:
//   startEmailChallenge  → supersede the live code, store HMAC, email the code.
//   verifyEmailChallenge → one attempt per call (optimistic update on
//                          `attempts`), constant-time compare, then confirm the
//                          email on THIS auth user and record the seller lead.
//   sendResumeLink       → magic link back to the draft, only for an email that
//                          passed the gate (seller_leads), so it can never be
//                          used to mail an arbitrary address.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createService } from "@/lib/supabase/service";
import { SITE_URL } from "@/lib/config";
import { sendListingEmailCode, sendListingResumeLink } from "@/lib/email";
import {
  CODE_TTL_MINUTES,
  MAX_SENDS_PER_HOUR,
  codeHmac,
  generateCode,
  hmacMatches,
  isCodeFormat,
  resumePath,
} from "@/lib/listing-email-gate";

type Lang = "en" | "es";

function pepper(): string {
  return process.env.EMAIL_CODE_PEPPER ?? "";
}

/** True when the email already belongs to a DIFFERENT account. */
export async function emailTakenByAnotherUser(
  email: string,
  userId: string | null,
  svc: SupabaseClient = createService(),
): Promise<boolean> {
  const { data } = await svc
    .from("users")
    .select("id")
    .eq("email", email)
    .limit(2);
  return (data ?? []).some((r: { id: string }) => r.id !== userId);
}

export type StartResult = "sent" | "limit" | "send_failed" | "not_configured";

export async function startEmailChallenge(input: {
  userId: string;
  email: string;
  lang: Lang;
}): Promise<StartResult> {
  if (!pepper()) {
    console.error("listing email gate: EMAIL_CODE_PEPPER not configured");
    return "not_configured";
  }
  const svc = createService();

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await svc
    .from("email_verification_challenges")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.userId)
    .gte("sent_at", since);
  if ((count ?? 0) >= MAX_SENDS_PER_HOUR) return "limit";

  // One live code per user (partial unique index): retire the previous one.
  await svc
    .from("email_verification_challenges")
    .update({ status: "superseded" })
    .eq("user_id", input.userId)
    .eq("status", "pending");

  const id = randomUUID();
  const code = generateCode();
  const { error } = await svc.from("email_verification_challenges").insert({
    id,
    user_id: input.userId,
    email: input.email,
    purpose: "listing_gate",
    code_hmac: codeHmac(pepper(), id, code),
    expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
  });
  if (error) {
    console.error("listing email gate: challenge insert failed", error.message);
    return "send_failed";
  }

  const sent = await sendListingEmailCode({
    to: input.email,
    lang: input.lang,
    code,
    minutes: CODE_TTL_MINUTES,
  });
  return sent.ok ? "sent" : "send_failed";
}

/** The email the user is currently being asked to confirm, if any. */
export async function pendingChallengeEmail(userId: string): Promise<string | null> {
  const { data } = await createService()
    .from("email_verification_challenges")
    .select("email")
    .eq("user_id", userId)
    .eq("status", "pending")
    .maybeSingle();
  return (data as { email: string } | null)?.email ?? null;
}

export type VerifyResult = "verified" | "invalid" | "expired" | "exists" | "failed";

export async function verifyEmailChallenge(input: {
  userId: string;
  code: string;
  lang: Lang;
  propertyId: string | null;
}): Promise<VerifyResult> {
  if (!isCodeFormat(input.code) || !pepper()) return "invalid";
  const svc = createService();

  const { data: row } = await svc
    .from("email_verification_challenges")
    .select("id, email, code_hmac, attempts, max_attempts, expires_at")
    .eq("user_id", input.userId)
    .eq("status", "pending")
    .maybeSingle();
  if (!row) return "expired";
  const ch = row as {
    id: string;
    email: string;
    code_hmac: string;
    attempts: number;
    max_attempts: number;
    expires_at: string;
  };

  if (new Date(ch.expires_at).getTime() <= Date.now()) {
    await svc
      .from("email_verification_challenges")
      .update({ status: "expired" })
      .eq("id", ch.id)
      .eq("status", "pending");
    return "expired";
  }
  if (ch.attempts >= ch.max_attempts) return "expired";

  // Spend one attempt. Conditioning on the attempts value we read makes the
  // increment atomic: two concurrent guesses can't both use the same attempt.
  const nextAttempts = ch.attempts + 1;
  const { data: spent } = await svc
    .from("email_verification_challenges")
    .update({ attempts: nextAttempts })
    .eq("id", ch.id)
    .eq("status", "pending")
    .eq("attempts", ch.attempts)
    .select("id");
  if (!spent || spent.length === 0) return "invalid";

  if (!hmacMatches(ch.code_hmac, codeHmac(pepper(), ch.id, input.code))) {
    if (nextAttempts >= ch.max_attempts) {
      await svc
        .from("email_verification_challenges")
        .update({ status: "locked" })
        .eq("id", ch.id)
        .eq("status", "pending");
      return "expired";
    }
    return "invalid";
  }

  // Possession proven. Confirm the address on THIS user only (global
  // auto-confirm stays off). `account_pending` tells step 7 the seller still
  // has to add their name and a password before signing.
  const { error: authError } = await svc.auth.admin.updateUserById(input.userId, {
    email: ch.email,
    email_confirm: true,
    user_metadata: { account_pending: true },
  });
  if (authError) {
    const exists = /already|registered|exists/i.test(authError.message);
    console.error("listing email gate: confirm failed", authError.message);
    return exists ? "exists" : "failed";
  }

  await svc
    .from("email_verification_challenges")
    .update({ status: "verified", verified_at: new Date().toISOString() })
    .eq("id", ch.id);

  await svc
    .from("users")
    .upsert({ id: input.userId, email: ch.email }, { onConflict: "id" });

  const { error: leadError } = await svc.from("seller_leads").upsert(
    {
      user_id: input.userId,
      email: ch.email,
      locale: input.lang,
      property_id: input.propertyId,
      status: "email_captured",
      current_step: 1,
      last_step_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (leadError) console.error("listing email gate: lead upsert failed", leadError.message);

  return "verified";
}

/** Best-effort: remember the furthest step reached so the magic link lands there. */
export async function recordLeadStep(userId: string, propertyId: string, step: number) {
  const svc = createService();
  const { data } = await svc
    .from("seller_leads")
    .select("current_step")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return;
  const current = (data as { current_step: number | null }).current_step ?? 0;
  await svc
    .from("seller_leads")
    .update({
      property_id: propertyId,
      status: "in_progress",
      current_step: Math.max(current, step),
      last_step_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

export type ResumeResult = "sent" | "no_lead" | "failed";

/**
 * Emails a one-click sign-in link back to the seller's draft. Looks the seller
 * up in seller_leads (only emails verified at the gate). The link uses the
 * token-hash flow (/auth/confirm), so it works on any device, not only the
 * browser that started the listing.
 */
export async function sendResumeLink(input: {
  email?: string;
  userId?: string;
  lang?: Lang;
}): Promise<ResumeResult> {
  const svc = createService();
  let q = svc
    .from("seller_leads")
    .select("user_id, email, locale, property_id, current_step");
  if (input.userId) q = q.eq("user_id", input.userId);
  else if (input.email) q = q.eq("email", input.email);
  else return "no_lead";
  const { data } = await q.limit(1).maybeSingle();
  if (!data) return "no_lead";
  const lead = data as {
    user_id: string;
    email: string;
    locale: Lang;
    property_id: string | null;
    current_step: number | null;
  };
  const lang = input.lang ?? lead.locale ?? "en";

  const { data: link, error } = await svc.auth.admin.generateLink({
    type: "magiclink",
    email: lead.email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error("listing resume: generateLink failed", error?.message);
    return "failed";
  }

  const next = resumePath(lang, lead.property_id, lead.current_step);
  const url = `${SITE_URL}/${lang}/auth/confirm?token_hash=${encodeURIComponent(
    tokenHash,
  )}&type=email&next=${encodeURIComponent(next)}`;

  const sent = await sendListingResumeLink({ to: lead.email, lang, url });
  return sent.ok ? "sent" : "failed";
}
