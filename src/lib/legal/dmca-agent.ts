// Designated Copyright Agent — single source of truth for the DMCA page.
//
// WHY THIS FILE EXISTS SEPARATELY: 17 U.S.C. § 512(c)(2) only grants safe-harbor
// protection if the agent is BOTH registered with the U.S. Copyright Office AND
// published on the site. The MIAMI AOR Data License Agreement § VII.B.2 requires
// the same, as a condition of receiving the MLS data feed.
//
// ─────────────────────────────────────────────────────────────────────────────
// OWNER ACTION REQUIRED — the three [PLACEHOLDER] values below.
//
// 1. Register at https://dmca.copyright.gov (US Copyright Office, ~$6, one
//    account per service provider). Register the LEGAL ENTITY: "Lixtara, LLC".
// 2. Copy the registered values into this file EXACTLY as filed. They must match
//    the registry, or the safe harbor is defective.
// 3. Registration must be renewed every three (3) years or it lapses.
//
// `dmca-agent.test.ts` FAILS while any placeholder remains, so an incomplete
// agent cannot reach production.
// ─────────────────────────────────────────────────────────────────────────────

export interface DmcaAgent {
  /** Service provider legal entity, as filed with the Copyright Office. */
  entity: string;
  /** Agent name or role, as filed. */
  agentName: string;
  /** Full mailing address, as filed. */
  addressLines: string[];
  email: string;
  phone: string;
  /** ISO date the registration was filed. Renewal is due 3 years later. */
  registeredOn: string;
}

export const DMCA_AGENT: DmcaAgent = {
  entity: "Lixtara, LLC",
  agentName: "Copyright Agent, Lixtara, LLC",
  addressLines: ["[STREET ADDRESS]", "Miami, Florida [ZIP]", "United States"],
  email: "dmca@lixtara.com",
  phone: "[PHONE]",
  registeredOn: "[YYYY-MM-DD]",
};

/** Values that must be replaced before the DMCA page may go live. */
export const DMCA_PLACEHOLDER_PATTERN = /\[[A-Z][A-Z\s-]*\]/;

/** True once every field carries a real, filed value. */
export function isDmcaAgentComplete(agent: DmcaAgent = DMCA_AGENT): boolean {
  const values = [
    agent.entity, agent.agentName, agent.email, agent.phone,
    agent.registeredOn, ...agent.addressLines,
  ];
  return values.every((v) => v.trim().length > 0 && !DMCA_PLACEHOLDER_PATTERN.test(v));
}

// ─────────────────────────────────────────────────────────────────────────────
// MLS FORWARDING DUTY — operational, not shown on the public page.
//
// The MIAMI AOR agreement requires that a takedown notice be forwarded to MIAMI
// IN WRITING WITHIN 24 HOURS of receipt. Two addresses are named because Lixtara
// is both the Participant (§ VII.C.2 → dmca@miamire.com) and the Technology
// Provider (§ VII.B.2 → legal@miamire.com). Send to BOTH.
// Runbook: docs/legal/2026-09-07-dmca-runbook.md
// ─────────────────────────────────────────────────────────────────────────────
export const MLS_TAKEDOWN_NOTICE_RECIPIENTS = ["legal@miamire.com", "dmca@miamire.com"] as const;
export const MLS_TAKEDOWN_NOTICE_DEADLINE_HOURS = 24;
