// AI virtual-staging overage credit wallet (public.staging_credits).
// Each listing gets STAGING_FREE_QUOTA free staged photos; beyond that a
// purchased credit is consumed. All mutations go through the service-role
// client (the webhook grants, the staging route consumes) — RLS only lets a
// user READ their own balance.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface StagingBalance {
  purchased: number;
  used: number;
  remaining: number;
}

export async function getStagingBalance(
  svc: SupabaseClient,
  userId: string,
): Promise<StagingBalance> {
  const { data } = await svc
    .from("staging_credits")
    .select("purchased, used")
    .eq("user_id", userId)
    .maybeSingle();
  const purchased = data?.purchased ?? 0;
  const used = data?.used ?? 0;
  return { purchased, used, remaining: Math.max(0, purchased - used) };
}

// Consume one credit. Returns true only if one was available + consumed.
// Read-then-write: staging is slow (~60s) and rarely concurrent per user, so
// the race window is negligible for this MVP.
export async function consumeStagingCredit(
  svc: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { used, remaining } = await getStagingBalance(svc, userId);
  if (remaining <= 0) return false;
  await svc
    .from("staging_credits")
    .update({ used: used + 1, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  return true;
}

// Grant N purchased credits (Stripe webhook on payment). Upserts the wallet.
export async function grantStagingCredits(
  svc: SupabaseClient,
  userId: string,
  n: number,
): Promise<void> {
  if (n <= 0) return;
  const { data } = await svc
    .from("staging_credits")
    .select("purchased")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) {
    await svc
      .from("staging_credits")
      .update({
        purchased: (data.purchased ?? 0) + n,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  } else {
    await svc
      .from("staging_credits")
      .insert({ user_id: userId, purchased: n, used: 0 });
  }
}
