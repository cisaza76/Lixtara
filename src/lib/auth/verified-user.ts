import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { resumePath } from "@/lib/listing-email-gate";

// The listing flow signs sellers in anonymously at step 1 (role `authenticated`,
// no email). That session is real for RLS — it owns its draft — but it is NOT a
// person we can reach or hold accountable. Everything outside the seller's own
// draft treats it as signed out.

type AuthUser = Pick<User, "is_anonymous" | "email" | "email_confirmed_at" | "user_metadata">;

/** A session with a confirmed email: not anonymous, email set and confirmed. */
export function isVerifiedUser<T extends AuthUser>(user: T | null | undefined): user is T {
  return !!user && user.is_anonymous !== true && !!user.email && !!user.email_confirmed_at;
}

/**
 * A seller still inside the listing flow: anonymous / unconfirmed, or email
 * confirmed with the step-1 code but no name and password yet (`account_pending`).
 * The header and the auth pages send these back to their draft instead of
 * offering a sign-out or another account, which would orphan it.
 */
export function isListingSession(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return !isVerifiedUser(user) || user.user_metadata?.account_pending === true;
}

/** The newest draft this session owns (RLS: owner_id = auth.uid()), or null. */
export async function findOwnDraftId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("properties")
    .select("id")
    .eq("owner_id", userId)
    .eq("mls_status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Where "Continue my listing" goes: the furthest step recorded by the email
 * gate when there is one, else the draft's step 1 (the gate itself bounces an
 * email-less session there anyway).
 */
export async function listingResumeHref(
  supabase: SupabaseClient,
  userId: string,
  lang: string,
): Promise<string | null> {
  const draftId = await findOwnDraftId(supabase, userId);
  if (!draftId) return null;
  const { data: lead } = await supabase
    .from("seller_leads")
    .select("property_id, current_step")
    .eq("user_id", userId)
    .maybeSingle();
  const l = lead as { property_id: string | null; current_step: number | null } | null;
  if (l?.property_id === draftId && l.current_step && l.current_step >= 2) {
    return resumePath(lang, draftId, l.current_step);
  }
  return `/${lang}/listing/new?id=${encodeURIComponent(draftId)}&step=1`;
}

/**
 * Route-handler guard: 401 `not_authenticated` for no session AND for an
 * anonymous / unconfirmed one, so clients keep a single "sign in" path.
 */
export async function requireVerifiedUser(
  supabase: SupabaseClient,
): Promise<{ user: User; response: null } | { user: null; response: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isVerifiedUser(user)) {
    return { user: null, response: NextResponse.json({ error: "not_authenticated" }, { status: 401 }) };
  }
  return { user, response: null };
}
