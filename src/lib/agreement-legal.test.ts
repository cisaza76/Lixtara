// Admin: sin descripción legal verificada en el último acuerdo, no se aprueba ni se publica
// el listing (#217). Sin red.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { legalPendingMessage, pendingLegalFrom } from "./agreement-legal";

const ag = (property_id: string, legal_description_status: string | null, created_at: string) => ({ property_id, legal_description_status, created_at });

describe("descripción legal pendiente", () => {
  it("bloquea si el ÚLTIMO acuerdo no está «verified» (null = anterior a la columna = pendiente)", () => {
    const pending = pendingLegalFrom([
      ag("p1", "pending", "2026-10-01"),
      ag("p2", "pending", "2026-10-01"),
      ag("p2", "verified", "2026-10-05"),
      ag("p3", null, "2026-10-01"),
      ag("p4", "verified", "2026-10-01"),
    ]);
    // p1 pendiente; p2 ya tiene un acuerdo nuevo verificado; p3 es anterior a la columna; p4 verificado.
    expect([...pending].sort()).toEqual(["p1", "p3"]);
  });

  it("el mensaje es el del owner", () => {
    expect(legalPendingMessage("es")).toBe("Falta descripción legal verificada");
    expect(legalPendingMessage("en")).toBe("Verified legal description missing");
  });

  it("las dos acciones de aprobar lo comprueban en el servidor y deshabilitan el botón", () => {
    // Las dos acciones pasan por approvalBlocker (approval-gate.server.ts).
    const home = readFileSync("src/app/[lang]/admin/page.tsx", "utf8");
    expect(home).toContain("const blocked = await approvalBlocker(supabase, id);");
    // La tarjeta: legalPending es uno de los motivos que deshabilitan el botón (admin-approval-reasons).
    expect(home).toContain("legalPending: legalPending.has(p.id),");
    expect(home).toContain("disabled={reasons.length > 0}");
    const review = readFileSync("src/app/[lang]/admin/listings/[id]/review/page.tsx", "utf8");
    expect(review).toContain("const blocked = await approvalBlocker(supabase, id);");
    expect(review).toContain("disabled={legalPending ||");
    // El bloqueo va antes de la consulta a DocuSign.
    const gate = readFileSync("src/lib/approval-gate.server.ts", "utf8");
    expect(gate.indexOf('return "legal_pending"')).toBeGreaterThan(0);
    expect(gate.indexOf('return "legal_pending"')).toBeLessThan(gate.indexOf("deps.countersigned(id)"));
  });

  it("el acuerdo se guarda con su estado (columna) y la auditoría queda en activity_log", () => {
    const route = readFileSync("src/app/api/agreement/create/route.ts", "utf8");
    expect(route).toContain("legal_description_status: contract.legalStatus,");
    expect(route).toMatch(/await createService\(\)\s*\.from\("agreements"\)\s*\.insert\(/);
    expect(route).toContain("await recordAgreementSent({ propertyId, userId: user.id, envelopeId, legal: contract.legalStatus });");
    const gate = readFileSync("src/lib/agreement-legal.server.ts", "utf8");
    // El bloqueo lee la columna, no activity_log; si falla la lectura, el admin queda bloqueado.
    expect(gate).toContain('.select("property_id,legal_description_status,created_at")');
    expect(gate.slice(gate.indexOf("export async function pendingLegalByProperty"))).not.toContain("activity_log");
    expect(gate).toContain("return new Set(propertyIds);");
  });
});
