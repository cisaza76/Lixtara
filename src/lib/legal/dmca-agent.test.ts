import { describe, it, expect } from "vitest";
import {
  DMCA_REGISTRATION,
  publicAgentBlock,
  dmcaStatus,
  daysUntilDmcaExpiry,
  DMCA_RENEWAL_WARNING_DAYS,
  MLS_TAKEDOWN_NOTICE_RECIPIENTS,
  MLS_TAKEDOWN_NOTICE_DEADLINE_HOURS,
} from "./dmca-agent";

describe("DMCA registration record", () => {
  it("matches the filing with the U.S. Copyright Office", () => {
    // Si estos valores dejan de coincidir con el registro, el safe harbor queda
    // defectuoso. Están fijados a propósito.
    expect(DMCA_REGISTRATION.registrationNumber).toBe("DMCA-1080195");
    expect(DMCA_REGISTRATION.registeredOn).toBe("2026-09-10");
    expect(DMCA_REGISTRATION.expiresOn).toBe("2029-09-10");
    // Confirmado "Active" por la Copyright Office, no solo presentado.
    expect(DMCA_REGISTRATION.confirmedActiveOn).toBe("2026-09-10");
    expect(DMCA_REGISTRATION.serviceProvider.legalName).toBe("LIXTARA LLC");
  });

  it("expires exactly three years after registration", () => {
    const reg = new Date(`${DMCA_REGISTRATION.registeredOn}T00:00:00Z`);
    const exp = new Date(`${DMCA_REGISTRATION.expiresOn}T00:00:00Z`);
    expect(exp.getUTCFullYear() - reg.getUTCFullYear()).toBe(3);
    expect(exp.getUTCMonth()).toBe(reg.getUTCMonth());
    expect(exp.getUTCDate()).toBe(reg.getUTCDate());
  });
});

describe("public agent block", () => {
  const block = publicAgentBlock().join("\n");

  it("publishes the designated agent's public contact", () => {
    expect(block).toContain("dmca@lixtara.com");
    expect(block).toContain("786-210-3562");
    expect(block).toContain("181 Vera Court");
    expect(block).toContain("Coral Gables, FL 33143");
    expect(block).toContain("DMCA-1080195");
  });

  it("NEVER leaks the administrative contact", () => {
    // El contacto del service provider es de la cuenta ante la Copyright Office,
    // no un canal público. Este test es la razón de que el bloque público se
    // construya con un helper en vez de leer el objeto entero.
    expect(block).not.toContain(DMCA_REGISTRATION.serviceProvider.adminContact.email);
    expect(block).not.toContain(DMCA_REGISTRATION.serviceProvider.adminContact.phone);
    expect(block).not.toContain("camilo@");
    expect(block).not.toContain("305-522-3454");
  });
});

describe("renewal guard", () => {
  it("classifies the lifecycle around the expiry date", () => {
    expect(dmcaStatus(new Date("2027-01-01T00:00:00Z"))).toBe("active");
    expect(dmcaStatus(new Date("2029-08-01T00:00:00Z"))).toBe("expiring_soon");
    expect(dmcaStatus(new Date("2029-09-11T00:00:00Z"))).toBe("expired");
  });

  it("counts days remaining", () => {
    expect(daysUntilDmcaExpiry(new Date("2029-09-01T00:00:00Z"))).toBe(9);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GUARD REAL. Falla cuando faltan 60 días o menos para el vencimiento.
  //
  // Es deliberado que rompa la suite: el registro NO se renueva solo, y al
  // caducar el safe harbor del § 512 desaparece sin que nada más falle. Un test
  // rojo es la única señal que este equipo no puede ignorar, porque los cinco
  // gates corren en cada push y cada PR.
  //
  // CUANDO ESTE TEST FALLE:
  //   1. Recertifica en https://dmca.copyright.gov (~$6, ~15 min).
  //   2. Actualiza registeredOn y expiresOn en dmca-agent.ts.
  //   3. Actualiza las fechas fijadas en el primer test de este archivo.
  // ─────────────────────────────────────────────────────────────────────────
  it("the registration is current (renew when this fails)", () => {
    const status = dmcaStatus(new Date());
    const days = daysUntilDmcaExpiry(new Date());
    expect(
      status,
      `El registro DMCA ${DMCA_REGISTRATION.registrationNumber} vence el ` +
      `${DMCA_REGISTRATION.expiresOn} (faltan ${days} días). Recertifica en ` +
      `https://dmca.copyright.gov y actualiza dmca-agent.ts. Sin recertificar, ` +
      `el safe harbor del 17 U.S.C. § 512 se pierde en silencio.`,
    ).toBe("active");
    expect(days).toBeGreaterThan(DMCA_RENEWAL_WARNING_DAYS);
  });
});

describe("MLS takedown forwarding", () => {
  it("forwards to both MIAMI addresses within 24 hours", () => {
    // Lixtara es Participant (§ VII.C.2) y Technology Provider (§ VII.B.2), y el
    // acuerdo nombra una dirección distinta para cada rol.
    expect(MLS_TAKEDOWN_NOTICE_RECIPIENTS).toContain("legal@miamire.com");
    expect(MLS_TAKEDOWN_NOTICE_RECIPIENTS).toContain("dmca@miamire.com");
    expect(MLS_TAKEDOWN_NOTICE_DEADLINE_HOURS).toBe(24);
  });
});
