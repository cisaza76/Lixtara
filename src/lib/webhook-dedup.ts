import type { SupabaseClient } from "@supabase/supabase-js";

// Postgres unique_violation — the dedup table's (vendor, event_id) constraint
// fires this when we try to claim an event we've already seen.
const PG_UNIQUE_VIOLATION = "23505";

export type ClaimResult = "claimed" | "duplicate" | "unavailable";

/**
 * Idempotency claim for an inbound webhook event. Inserts (vendor, event_id)
 * into processed_webhook_events and interprets the outcome:
 *
 *  - "claimed"     → first time seeing this event; the caller should process it.
 *  - "duplicate"   → already claimed (unique violation); ack and skip side effects.
 *  - "unavailable" → the dedup store errored for some other reason (e.g. the
 *                    table doesn't exist yet because the migration hasn't been
 *                    applied). The caller should FAIL OPEN and process anyway —
 *                    a duplicate email is far better than a dropped payment
 *                    state transition.
 *
 * Insert-first (rather than check-then-insert) so concurrent duplicate
 * deliveries can't both win the race — the unique constraint serializes them.
 */
export async function claimWebhookEvent(
  supabase: SupabaseClient,
  vendor: string,
  eventId: string,
  eventType?: string,
): Promise<ClaimResult> {
  const { error } = await supabase
    .from("processed_webhook_events")
    .insert({ vendor, event_id: eventId, event_type: eventType ?? null });

  if (!error) return "claimed";
  if (error.code === PG_UNIQUE_VIOLATION) return "duplicate";

  console.error(
    "webhook dedup claim failed — processing anyway (fail open):",
    error.message,
  );
  return "unavailable";
}
