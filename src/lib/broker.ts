// Lixtara is both the consumer-facing brand and the licensed brokerage entity.
//
// Brokerage license CQ1075352 — a Florida DBPR real-estate CORPORATION license
// (prefix CQ = entity, not individual). Issued and active as of 2026-09-02.
// The i18n `licensePending` labels remain as a graceful fallback if this
// constant is ever emptied; they are not reachable while it is set.

export const BROKERAGE_NAME = "Lixtara";
export const BROKERAGE_LICENSED_ENTITY = "Lixtara";
export const BROKER_LICENSE = "CQ1075352";
export const BROKERAGE_LOCATION = "Miami, FL";
export const BROKERAGE_YEARS = 20;

// NOT for display in marketing copy (Lixtara is a corporate brand, not a
// personal one). She IS named in the Terms of Service as the principal broker
// of record — that is a Florida Statute 475 disclosure, not branding.
export const BROKER_OF_RECORD = "AnaMaria Velasquez";

// ── CAN-SPAM sender identity (commercial email) ─────────────────────────────
// OWNER: fill both before any marketing / funnel email can go out. While either
// is empty, sendCommercialEmail() (src/lib/email.ts) refuses to send — the
// check is in code (src/lib/email-compliance.ts), not just this comment.
// - BROKERAGE_LEGAL_NAME: the registered legal entity name (as on Sunbiz/DBPR).
// - BROKERAGE_POSTAL_ADDRESS: a valid physical postal address — street address,
//   USPS-registered PO box, or a registered commercial mail receiving agency.
export const BROKERAGE_LEGAL_NAME = "";
export const BROKERAGE_POSTAL_ADDRESS = "";
