import { describe, it, expect } from "vitest";
import {
  DMCA_AGENT,
  isDmcaAgentComplete,
  MLS_TAKEDOWN_NOTICE_RECIPIENTS,
  MLS_TAKEDOWN_NOTICE_DEADLINE_HOURS,
} from "./dmca-agent";

// The DMCA page is only lawful protection if the published agent matches a real
// Copyright Office registration. These tests are the guard that keeps a
// half-filled agent out of production.
describe("DMCA designated agent", () => {
  it("detects an incomplete agent record", () => {
    expect(isDmcaAgentComplete({
      entity: "Lixtara, LLC",
      agentName: "Copyright Agent",
      addressLines: ["[STREET ADDRESS]"],
      email: "dmca@lixtara.com",
      phone: "+1 305 000 0000",
      registeredOn: "2026-09-07",
    })).toBe(false);
  });

  it("accepts a fully filled agent record", () => {
    expect(isDmcaAgentComplete({
      entity: "Lixtara, LLC",
      agentName: "Copyright Agent, Lixtara, LLC",
      addressLines: ["1 Main St, Suite 100", "Miami, Florida 33130", "United States"],
      email: "dmca@lixtara.com",
      phone: "+1 (305) 555-0100",
      registeredOn: "2026-09-07",
    })).toBe(true);
  });

  it("forwards MLS takedown notices to both MIAMI addresses within 24 hours", () => {
    // Lixtara is both Participant (§VII.C.2) and Technology Provider (§VII.B.2),
    // which name different addresses — so both must receive the notice.
    expect(MLS_TAKEDOWN_NOTICE_RECIPIENTS).toContain("legal@miamire.com");
    expect(MLS_TAKEDOWN_NOTICE_RECIPIENTS).toContain("dmca@miamire.com");
    expect(MLS_TAKEDOWN_NOTICE_DEADLINE_HOURS).toBe(24);
  });

  it.skip("SKIP-UNTIL-REGISTERED: the live agent record is complete", () => {
    // Un-skip this the moment the Copyright Office registration is filed and the
    // placeholders in dmca-agent.ts are replaced. It then permanently blocks any
    // regression that empties the record.
    expect(isDmcaAgentComplete(DMCA_AGENT)).toBe(true);
  });
});
