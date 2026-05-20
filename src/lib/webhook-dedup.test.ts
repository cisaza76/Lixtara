import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimWebhookEvent } from "@/lib/webhook-dedup";

// Minimal stub: claimWebhookEvent only ever calls
// supabase.from(table).insert(row) and awaits { error }.
function clientReturning(result: {
  error: { code?: string; message?: string } | null;
}): SupabaseClient {
  return {
    from: () => ({ insert: () => Promise.resolve(result) }),
  } as unknown as SupabaseClient;
}

describe("claimWebhookEvent", () => {
  it("returns 'claimed' on a clean insert (first time seeing the event)", async () => {
    const result = await claimWebhookEvent(
      clientReturning({ error: null }),
      "stripe",
      "evt_1",
      "checkout.session.completed",
    );
    expect(result).toBe("claimed");
  });

  it("returns 'duplicate' on a unique violation (already processed)", async () => {
    const result = await claimWebhookEvent(
      clientReturning({ error: { code: "23505", message: "duplicate key" } }),
      "stripe",
      "evt_1",
    );
    expect(result).toBe("duplicate");
  });

  it("returns 'unavailable' (fail open) when the table is missing or store errors", async () => {
    const result = await claimWebhookEvent(
      clientReturning({
        error: { code: "42P01", message: 'relation "processed_webhook_events" does not exist' },
      }),
      "stripe",
      "evt_1",
    );
    expect(result).toBe("unavailable");
  });
});
