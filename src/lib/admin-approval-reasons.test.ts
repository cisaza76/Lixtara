// La tarjeta de /admin dice todos los motivos por los que no se puede aprobar, no solo el primero.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { approvalReasons, testListingMessage } from "@/lib/admin-approval-reasons";
import { SIGNERS_ADMIN_COPY } from "@/lib/listing-signers-admin";

const none = { isTest: false, legalPending: false, ownerBlocked: null, agreementBlocked: null, agreementStatus: "completed" };

describe("approvalReasons", () => {
  it("sin motivos: se puede aprobar", () => {
    expect(approvalReasons(none, "es")).toEqual([]);
  });

  it("de prueba Y con el acuerdo anulado: los dos (antes solo salía el de prueba)", () => {
    const r = approvalReasons({ ...none, isTest: true, agreementBlocked: "agreement_void", agreementStatus: "voided" }, "es");
    expect(r.map((x) => x.kind)).toEqual(["test_listing", "agreement"]);
    expect(r[0].message).toBe("Listado de prueba: no se puede aprobar ni publicar.");
    expect(r[1].message).toBe("El acuerdo de listado está anulado: el vendedor tiene que enviar uno nuevo antes de aprobar.");
  });

  it("todos a la vez, en el orden del servidor, con el código de cada uno", () => {
    const r = approvalReasons(
      { isTest: true, legalPending: true, ownerBlocked: "sunbiz_unchecked", agreementBlocked: "countersign_missing", agreementStatus: "signed" },
      "en",
    );
    expect(r.map((x) => [x.kind, x.code, x.openReview])).toEqual([
      ["test_listing", "test_listing", false],
      ["legal_pending", "legal_pending", false],
      ["owner", "sunbiz_unchecked", true],
      ["agreement", "countersign_missing", true],
    ]);
    expect(r[2].message).toBe(SIGNERS_ADMIN_COPY.en.gate.sunbiz_unchecked);
    expect(r.every((x) => x.message.length > 0)).toBe(true);
  });

  it("texto del listado de prueba en EN/ES", () => {
    expect(testListingMessage("en")).toBe("Test listing: it can't be approved or published.");
    expect(testListingMessage("es")).toBe("Listado de prueba: no se puede aprobar ni publicar.");
  });

  it("la tarjeta los muestra todos y deshabilita el botón con cualquiera", () => {
    const home = readFileSync("src/app/[lang]/admin/page.tsx", "utf8");
    expect(home).toContain("const reasons = approvalReasons(");
    expect(home).toContain("disabled={reasons.length > 0}");
    expect(home).toContain("{reasons.map((r) => (");
    expect(home).toContain("data-approval-reason={r.kind}");
    expect(home).not.toContain("!p.is_test && agreementBlocked");
  });
});
