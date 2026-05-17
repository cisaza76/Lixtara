import { createClient } from "@supabase/supabase-js";

// Service-role client for server-side reads that need to bypass RLS.
// NEVER call this from a client component or expose its results raw to the browser
// without filtering. The Lovable RLS policies have a recursion bug on `users`
// that blocks publishable-key reads of `properties`; this client is the F1b
// workaround. Long-term fix: rewrite the policies (F2 will need to touch RLS
// anyway for the seller flow).
export function createService() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
}
