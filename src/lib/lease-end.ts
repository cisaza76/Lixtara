// Step 3, tenant-occupied: lease end date as MM/DD/YYYY (the format of the listing agreement)
// and in the future, or "I don't know" (stored as null; the contract leaves the line empty).

export type LeaseEndError = "lease_end_required" | "lease_end_invalid" | "lease_end_past";

export type LeaseEndResult = { ok: true; iso: string | null } | { ok: false; error: LeaseEndError };

/** Today in Miami (where the listings are), as YYYY-MM-DD. */
export function todayInMiami(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** "12/31/2026" → "2026-12-31"; null if it isn't a real calendar date in MM/DD/YYYY. */
export function usDateToIso(raw: string): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(raw);
  if (!m) return null;
  const [mm, dd, yyyy] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** "2026-12-31" → "12/31/2026" (to show a stored date back in the form). */
export function isoToUsDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

export function parseLeaseEnd(raw: string, unknown: boolean, now: Date = new Date()): LeaseEndResult {
  if (unknown) return { ok: true, iso: null };
  if (!raw.trim()) return { ok: false, error: "lease_end_required" };
  const iso = usDateToIso(raw);
  if (!iso) return { ok: false, error: "lease_end_invalid" };
  if (iso <= todayInMiami(now)) return { ok: false, error: "lease_end_past" };
  return { ok: true, iso };
}
