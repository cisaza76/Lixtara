import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n";

/**
 * Server-side gate for the admin panel. Allows `admin` OR `broker` (Lixtara's
 * user_roles enum already has both). Redirects to sign-in when unauthenticated,
 * or to the seller dashboard when authenticated without an admin/broker role.
 *
 * Returns the count of pending broker tasks (for the nav badge); falls back to
 * 0 if the table isn't readable.
 */
export async function requireAdminOrBroker(lang: Locale): Promise<{
  pendingTasks: number;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/sign-in?next=/admin`);

  const [{ data: isAdmin }, { data: isBroker }] = await Promise.all([
    supabase.rpc("has_role", { _role: "admin" }),
    supabase.rpc("has_role", { _role: "broker" }),
  ]);
  if (isAdmin !== true && isBroker !== true) {
    redirect(`/${lang}/dashboard`);
  }

  const { count } = await supabase
    .from("broker_tasks")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return { pendingTasks: count ?? 0 };
}
