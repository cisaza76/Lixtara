import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n";

/**
 * Server-side auth gate. Call from a page or layout to require a signed-in
 * user — redirects to /sign-in?next=<current> if not authenticated.
 *
 * Returns the user object (typed as non-null since we redirect otherwise).
 */
export async function requireUser(lang: Locale, nextPath: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/${lang}/sign-in?next=${encodeURIComponent(nextPath)}`,
    );
  }
  return user;
}
