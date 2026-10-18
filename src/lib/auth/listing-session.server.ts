import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findOwnDraftId, isListingSession, isVerifiedUser } from "@/lib/auth/verified-user";
import { postSignInPath } from "@/lib/auth/safe-redirect";
import { isStaff } from "@/lib/admin-auth";

/**
 * /sign-in and /sign-up for a seller who is still in the listing flow: signing
 * in to another account or signing up creates a different uid and orphans the
 * anonymous draft (production test 2026-10-15). Send them back to step 7, which
 * turns THIS session into the permanent account. Without a draft it is a no-op.
 */
export async function returnListingSessionToDraft(lang: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isListingSession(user)) return;
  const draftId = await findOwnDraftId(supabase, user.id);
  if (draftId) redirect(`/${lang}/listing/new?id=${encodeURIComponent(draftId)}&step=7`);
}

/**
 * /sign-up with a real account already signed in: there is nothing to sign up for, so go
 * to the panel (staff → /admin, everyone else → /dashboard). Listing sessions are left to
 * returnListingSessionToDraft (they DO need step 7); without a session the form shows.
 */
export async function redirectSignedInToPanel(lang: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const staff = signedInPanelCandidate(user) ? await isStaff(supabase) : false;
  const dest = signedInPanelPath(user, lang, staff);
  if (dest) redirect(dest);
}

/** Real, confirmed account outside the listing flow. */
function signedInPanelCandidate(user: Parameters<typeof isVerifiedUser>[0]): boolean {
  return isVerifiedUser(user) && !isListingSession(user);
}

/** Where a signed-in visitor of /sign-up goes, or null to show the form. */
export function signedInPanelPath(
  user: Parameters<typeof isVerifiedUser>[0],
  lang: string,
  staff: boolean,
): string | null {
  if (!signedInPanelCandidate(user)) return null;
  return postSignInPath(`/${lang}/dashboard`, lang, staff);
}
