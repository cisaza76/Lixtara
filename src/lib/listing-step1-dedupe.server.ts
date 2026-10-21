import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A seller never means to start two listings within this window: a second step-1 send this
 * soon (double click, Enter on an address suggestion and then "Next") reuses the draft the
 * first one created instead of inserting another. Seen in production on 2026-10-20: two
 * drafts of the same owner, 1.5 s apart.
 */
export const STEP1_DEDUPE_WINDOW_MS = 2 * 60 * 1000;

/** The owner's draft created within the window, if any (newest first). Never throws. */
export async function recentOwnDraftId(
  supabase: SupabaseClient,
  ownerId: string,
  now: Date = new Date(),
): Promise<string | null> {
  try {
    const since = new Date(now.getTime() - STEP1_DEDUPE_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from("properties")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("mls_status", "draft")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return (data as { id: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}
