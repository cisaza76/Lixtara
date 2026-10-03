// Constantes de marca de la correduría. Los datos de licencia vienen de
// src/config/brokerage.ts (verificados en el DBPR) — no se repiten aquí.
//
// Lixtara LLC es a la vez la marca y la entidad licenciada: licencia CQ (corporación) de
// Florida. El broker de record se nombra en los avisos legales (Florida Statute 475) y en la
// línea de licencias del pie de página.
import { BROKERAGE } from "@/config/brokerage";

export const BROKERAGE_NAME = "Lixtara";
/** Nombre legal de la entidad licenciada; es el que va en acuerdos y avisos. */
export const BROKERAGE_LICENSED_ENTITY = BROKERAGE.legalName;
export const BROKER_LICENSE = BROKERAGE.brokerageLicense;
export const BROKERAGE_LOCATION = "Miami, FL";
export const BROKERAGE_YEARS = 20;

export const BROKER_OF_RECORD = BROKERAGE.brokerName;
export const BROKER_OF_RECORD_LICENSE = BROKERAGE.brokerLicense;

// ── CAN-SPAM sender identity (commercial email) ─────────────────────────────
// OWNER: fill both before any marketing / funnel email can go out. While either
// is empty, sendCommercialEmail() (src/lib/email.ts) refuses to send — the
// check is in code (src/lib/email-compliance.ts), not just this comment.
// - BROKERAGE_LEGAL_NAME: the registered legal entity name (as on Sunbiz/DBPR).
// - BROKERAGE_POSTAL_ADDRESS: a valid physical postal address — street address,
//   USPS-registered PO box, or a registered commercial mail receiving agency.
export const BROKERAGE_LEGAL_NAME = "";
export const BROKERAGE_POSTAL_ADDRESS = "";
