import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A second step-1 send of the SAME address this soon (double click, Enter on an address
 * suggestion and then "Next") reuses the draft the first one created instead of inserting
 * another. Seen in production on 2026-10-20: two drafts of the same owner, 1.5 s apart.
 * A DIFFERENT address always creates a new listing, however soon.
 */
export const STEP1_DEDUPE_WINDOW_MS = 2 * 60 * 1000;

// Street words written several ways by sellers and by Google ("Street"/"St", "North"/"N").
const STREET_WORDS: Record<string, string> = {
  street: "st", avenue: "ave", av: "ave", road: "rd", drive: "dr", boulevard: "blvd",
  lane: "ln", court: "ct", place: "pl", terrace: "ter", circle: "cir", highway: "hwy",
  parkway: "pkwy", way: "way", trail: "trl", north: "n", south: "s", east: "e", west: "w",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
  apartment: "unit", apt: "unit", suite: "unit", ste: "unit", "#": "unit",
};

/**
 * Comparable form of a stored street (with its unit) + ZIP: lowercase, no punctuation,
 * common abbreviations, 5-digit ZIP. "100 N.E. 1st Avenue, Unit 4" and "100 NE 1st Ave Apt 4"
 * are the same; another unit of the same building is not.
 */
export function normalizedAddressKey(street: string, zip: string): string {
  const words = street
    .toLowerCase()
    .replace(/#/g, " # ")
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_WORDS[w] ?? w);
  // "ne" may arrive as "n e" after stripping the dots of "N.E.".
  const joined = words.join(" ").replace(/\b([ns]) ([ew])\b/g, "$1$2").replace(/\bunit unit\b/g, "unit");
  return `${joined}|${zip.trim().slice(0, 5)}`;
}

/**
 * The owner's draft with the same address created within the window, if any (newest first).
 * Never throws: on any read failure step 1 creates a new draft, as before.
 */
export async function duplicateDraftId(
  supabase: SupabaseClient,
  ownerId: string,
  address: { street: string; zip: string },
  now: Date = new Date(),
): Promise<string | null> {
  try {
    const since = new Date(now.getTime() - STEP1_DEDUPE_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from("properties")
      .select("id,address_street,address_zip")
      .eq("owner_id", ownerId)
      .eq("mls_status", "draft")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error || !data) return null;
    const key = normalizedAddressKey(address.street, address.zip);
    const rows = data as Array<{ id: string; address_street: string | null; address_zip: string | null }>;
    return rows.find((r) => normalizedAddressKey(r.address_street ?? "", r.address_zip ?? "") === key)?.id ?? null;
  } catch {
    return null;
  }
}
