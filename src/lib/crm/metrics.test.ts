import { describe, it, expect } from "vitest";
import { campaignMetrics, rate } from "./metrics";

describe("campaignMetrics", () => {
  const members = [
    { owner_id: "s1", pilot_group: "Score" },
    { owner_id: "s2", pilot_group: "Score" },
    { owner_id: "c1", pilot_group: "Control" },
    { owner_id: "c2", pilot_group: "Control" },
  ];

  it("counts distinct owners per group (Score vs Control) and in total", () => {
    const { groups, total } = campaignMetrics(members, [
      { owner_id: "s1", event_type: "email_sent" },
      { owner_id: "s1", event_type: "email_sent" }, // step 2: same owner
      { owner_id: "s2", event_type: "email_sent" },
      { owner_id: "c1", event_type: "email_sent" },
      { owner_id: "s1", event_type: "reply_received" },
      { owner_id: "s1", event_type: "reply_received" },
      { owner_id: "s1", event_type: "lead_interested" },
      { owner_id: "s1", event_type: "lead_meeting_booked" }, // still one interested owner
      { owner_id: "c1", event_type: "lead_unsubscribed" },
      { owner_id: "c2", event_type: "email_bounced" },
    ]);
    expect(groups.Score).toEqual({ members: 2, sent: 2, replied: 1, interested: 1, unsubscribed: 0, bounced: 0 });
    expect(groups.Control).toEqual({ members: 2, sent: 1, replied: 0, interested: 0, unsubscribed: 1, bounced: 1 });
    expect(total).toEqual({ members: 4, sent: 3, replied: 1, interested: 1, unsubscribed: 1, bounced: 1 });
  });

  it("ignores events of owners outside the snapshot and noise events", () => {
    const { total } = campaignMetrics(members, [
      { owner_id: "stranger", event_type: "reply_received" },
      { owner_id: null, event_type: "reply_received" },
      { owner_id: "s1", event_type: "lead_neutral" },
    ]);
    expect(total).toEqual({ members: 4, sent: 0, replied: 0, interested: 0, unsubscribed: 0, bounced: 0 });
  });

  it("members without a pilot group go to their own bucket", () => {
    const { groups } = campaignMetrics([{ owner_id: "x", pilot_group: null }], []);
    expect(groups["—"].members).toBe(1);
  });
});

describe("rate", () => {
  it("formats percentages and avoids division by zero", () => {
    expect(rate(1, 4)).toBe("25.0%");
    expect(rate(0, 0)).toBe("—");
  });
});
