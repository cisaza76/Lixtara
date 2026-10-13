// Campaign metrics, per pilot group (Score vs Control) and in total. Every count
// is DISTINCT owners, not events: an owner who replies three times is one reply.
// Rates are over the campaign members of that group (the snapshot that was sent).

export interface MemberRow { owner_id: string; pilot_group: string | null }
export interface EventRow { owner_id: string | null; event_type: string }

export interface GroupMetrics {
  members: number;
  sent: number;
  replied: number;
  interested: number;
  unsubscribed: number;
  bounced: number;
}

const BUCKETS: Record<string, keyof Omit<GroupMetrics, "members">> = {
  email_sent: "sent",
  reply_received: "replied",
  lead_interested: "interested",
  lead_meeting_booked: "interested",
  lead_unsubscribed: "unsubscribed",
  email_bounced: "bounced",
};

const empty = (): GroupMetrics => ({ members: 0, sent: 0, replied: 0, interested: 0, unsubscribed: 0, bounced: 0 });

export const NO_GROUP = "—";

export function campaignMetrics(
  members: MemberRow[],
  events: EventRow[],
): { groups: Record<string, GroupMetrics>; total: GroupMetrics } {
  const groupOf = new Map(members.map((m) => [m.owner_id, m.pilot_group ?? NO_GROUP]));
  const seen = new Map<string, Set<string>>(); // `${group}:${bucket}` → owners
  const groups: Record<string, GroupMetrics> = {};
  const total = empty();

  for (const m of members) {
    const g = m.pilot_group ?? NO_GROUP;
    (groups[g] ??= empty()).members++;
    total.members++;
  }

  for (const e of events) {
    const bucket = BUCKETS[e.event_type];
    // Events of owners outside the snapshot (or unmatched) do not count.
    if (!bucket || !e.owner_id || !groupOf.has(e.owner_id)) continue;
    const g = groupOf.get(e.owner_id)!;
    for (const key of [`${g}:${bucket}`, `*:${bucket}`]) {
      const set = seen.get(key) ?? new Set<string>();
      if (set.has(e.owner_id)) continue;
      set.add(e.owner_id);
      seen.set(key, set);
      if (key.startsWith("*:")) total[bucket]++;
      else groups[g][bucket]++;
    }
  }
  return { groups, total };
}

export function rate(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—";
}
