// Admin: sin descripción legal verificada en el último acuerdo, no se aprueba ni se publica
// el listing (#217). Sin red.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { legalPendingMessage, pendingLegalFrom } from "./agreement-legal";

const ag = (property_id: string, envelope_id: string | null, created_at: string) => ({ property_id, envelope_id, created_at });
const log = (property_id: string, envelope_id: string, legal: string) => ({ property_id, metadata: { envelope_id, legal_description: legal } });

describe("descripción legal pendiente", () => {
  it("bloquea solo si el ÚLTIMO acuerdo salió con la descripción legal pendiente", () => {
    const pending = pendingLegalFrom(
      [ag("p1", "e1", "2026-10-01"), ag("p2", "e2", "2026-10-01"), ag("p2", "e3", "2026-10-05"), ag("p3", "e4", "2026-10-01"), ag("p4", null, "2026-10-01")],
      [log("p1", "e1", "pending"), log("p2", "e2", "pending"), log("p2", "e3", "verified"), log("p4", "x", "pending")],
    );
    // p1 pendiente; p2 ya tiene un acuerdo nuevo verificado; p3 es anterior al registro; p4 sin sobre.
    expect([...pending]).toEqual(["p1"]);
  });

  it("el mensaje es el del owner", () => {
    expect(legalPendingMessage("es")).toBe("Falta descripción legal verificada");
    expect(legalPendingMessage("en")).toBe("Verified legal description missing");
  });

  it("las dos acciones de aprobar lo comprueban en el servidor y deshabilitan el botón", () => {
    const home = readFileSync("src/app/[lang]/admin/page.tsx", "utf8");
    expect(home).toContain("if ((await pendingLegalByProperty([id])).has(id)) redirect(`/${lang}/admin?error=legal_pending`);");
    expect(home).toContain("disabled={legalPending.has(p.id)}");
    const review = readFileSync("src/app/[lang]/admin/listings/[id]/review/page.tsx", "utf8");
    expect(review).toContain("redirect(`/${lang}/admin/listings/${id}/review?error=legal_pending`);");
    expect(review).toContain("disabled={legalPending}");
    // El bloqueo va antes de la consulta a DocuSign y de cualquier escritura.
    expect(review.indexOf("error=legal_pending")).toBeLessThan(review.indexOf("checkBrokerCountersigned(id)"));
    expect(home.indexOf("error=legal_pending")).toBeLessThan(home.indexOf("checkBrokerCountersigned(id)"));
  });

  it("el sobre registra si la descripción legal salió verificada o pendiente", () => {
    const route = readFileSync("src/app/api/agreement/create/route.ts", "utf8");
    expect(route).toContain("await recordAgreementSent({ propertyId, userId: user.id, envelopeId, legal: contract.legalStatus });");
    // Si falla la lectura, el admin queda bloqueado (fail closed).
    expect(readFileSync("src/lib/agreement-legal.server.ts", "utf8")).toContain("return new Set(propertyIds);");
  });
});
