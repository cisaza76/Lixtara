import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findOwnDraftId, isListingSession } from "@/lib/auth/verified-user";

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
