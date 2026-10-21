// Terms of the seller's listing agreement that the site, the contract (ERS-21tn) and the legal
// texts all state. One source: the DocuSign tabs and the Terms read from here; nobody writes
// these numbers apart. Decisions of the broker (Anamaria, 2026-10-21).

/**
 * Protection period, in days after the termination date: a sale to a prospect introduced during
 * the listing still owes the commission (ERS-21tn line 123). Only buyers who toured the property
 * or made a written offer, named in writing within PROTECTION_NOTICE_DAYS (paragraph 15).
 */
export const PROTECTION_PERIOD_DAYS = 90;

/** Days after termination for the broker to deliver the protected buyers' names in writing. */
export const PROTECTION_NOTICE_DAYS = 10;

/** Broker's share of deposits the seller retains when a buyer defaults (ERS-21tn line 128). */
export const RETAINED_DEPOSITS_PCT = 0;
