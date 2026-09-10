// Designated Copyright Agent — registro oficial y única fuente de verdad.
//
// 17 U.S.C. § 512(c)(2) solo concede el safe harbor si el agente está registrado
// ante la U.S. Copyright Office Y publicado en el sitio. El acuerdo de datos de
// MIAMI AOR § VII.B.2 exige lo mismo como condición para activar el feed del MLS.
//
// REGISTRO VIGENTE: DMCA-1080195 · presentado 2026-09-10 · vence 2029-09-10.
//
// Los valores de abajo deben coincidir EXACTAMENTE con lo presentado ante la
// Copyright Office. Si divergen, el safe harbor queda defectuoso.

export interface DmcaAddress {
  line1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface DmcaContact {
  phone: string;
  email: string;
}

export interface DmcaRegistration {
  /** Número asignado por la Copyright Office. */
  registrationNumber: string;
  /** Fecha de presentación (ISO). */
  registeredOn: string;
  /** Caducidad: 3 años exactos desde el registro (ISO). */
  expiresOn: string;
  serviceProvider: {
    legalName: string;
    address: DmcaAddress;
    /**
     * ADMINISTRATIVO — NUNCA se renderiza en el sitio. Es el contacto de la
     * cuenta ante la Copyright Office, no el canal de avisos DMCA.
     */
    adminContact: DmcaContact;
  };
  designatedAgent: {
    name: string;
    organization: string;
    address: DmcaAddress;
    /** PÚBLICO — esto es lo que § 512(c)(2) obliga a publicar. */
    publicContact: DmcaContact;
  };
}

const REGISTERED_ADDRESS: DmcaAddress = {
  line1: "181 Vera Court",
  city: "Coral Gables",
  state: "FL",
  zip: "33143",
  country: "US",
};

export const DMCA_REGISTRATION: DmcaRegistration = {
  registrationNumber: "DMCA-1080195",
  registeredOn: "2026-09-10",
  expiresOn: "2029-09-10",
  serviceProvider: {
    legalName: "LIXTARA LLC",
    address: REGISTERED_ADDRESS,
    adminContact: { phone: "305-522-3454", email: "camilo@lixtara.com" },
  },
  designatedAgent: {
    name: "Copyright Agent",
    organization: "LIXTARA LLC",
    address: REGISTERED_ADDRESS,
    publicContact: { phone: "786-210-3562", email: "dmca@lixtara.com" },
  },
};

/**
 * Bloque de contacto publicable. Es la ÚNICA vía por la que la página DMCA debe
 * obtener datos del agente: toma exclusivamente los campos públicos, así que el
 * contacto administrativo no puede filtrarse al sitio por descuido.
 */
export function publicAgentBlock(reg: DmcaRegistration = DMCA_REGISTRATION): string[] {
  const a = reg.designatedAgent;
  return [
    a.name,
    a.organization,
    a.address.line1,
    `${a.address.city}, ${a.address.state} ${a.address.zip}`,
    a.address.country === "US" ? "United States" : a.address.country,
    `Email: ${a.publicContact.email}`,
    `Telephone: ${a.publicContact.phone}`,
    `U.S. Copyright Office Registration No. ${reg.registrationNumber}`,
  ];
}

// ── Vigencia ────────────────────────────────────────────────────────────────
/** Antelación con la que el guard empieza a exigir la recertificación. */
export const DMCA_RENEWAL_WARNING_DAYS = 60;

export type DmcaStatus = "active" | "expiring_soon" | "expired";

/**
 * El registro NO se renueva solo. Al vencer pasa a "Terminated" y el safe harbor
 * se pierde en silencio — nada en el producto falla, simplemente desaparece la
 * protección. Por eso hay un guard en tests: ver dmca-agent.test.ts.
 */
export function dmcaStatus(now: Date, reg: DmcaRegistration = DMCA_REGISTRATION): DmcaStatus {
  const expiry = new Date(`${reg.expiresOn}T00:00:00Z`).getTime();
  const days = (expiry - now.getTime()) / 86_400_000;
  if (days <= 0) return "expired";
  if (days <= DMCA_RENEWAL_WARNING_DAYS) return "expiring_soon";
  return "active";
}

export function daysUntilDmcaExpiry(now: Date, reg: DmcaRegistration = DMCA_REGISTRATION): number {
  const expiry = new Date(`${reg.expiresOn}T00:00:00Z`).getTime();
  return Math.floor((expiry - now.getTime()) / 86_400_000);
}

// ── Deber de reenvío al MLS ─────────────────────────────────────────────────
// Operativo, no se muestra en la página pública. El acuerdo obliga a reenviar la
// notificación POR ESCRITO DENTRO DE 24 HORAS. Nombra dos direcciones porque
// Lixtara es a la vez Participant (§ VII.C.2 → dmca@miamire.com) y Technology
// Provider (§ VII.B.2 → legal@miamire.com). Enviar a AMBAS.
// Runbook: docs/legal/2026-09-07-dmca-runbook.md
export const MLS_TAKEDOWN_NOTICE_RECIPIENTS = ["legal@miamire.com", "dmca@miamire.com"] as const;
export const MLS_TAKEDOWN_NOTICE_DEADLINE_HOURS = 24;
