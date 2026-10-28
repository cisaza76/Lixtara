// La acción de aprobar (inicio del admin y revisión) pasa por approvalBlocker: un listing de
// prueba se rechaza antes que nada, y uno con el sobre anulado no pasa la contrafirma.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({ createService: () => ({}) }));
vi.mock("@/lib/agreement-legal.server", () => ({ pendingLegalByProperty: async () => new Set() }));

import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { approvalBlocker, type ApprovalGateDeps } from "@/lib/approval-gate.server";
import { isTestListing, TEST_LISTING_ERROR } from "@/lib/listing-approval.server";

// properties.is_test con la sesión del admin (isTestListing real).
const sb = (isTest: boolean | null) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: isTest === null ? null : { is_test: isTest }, error: null }) }),
      }),
    }),
  }) as unknown as SupabaseClient;

const deps = (over: Partial<ApprovalGateDeps> = {}): ApprovalGateDeps => ({
  isTestListing,
  pendingLegal: async () => false,
  ownershipGate: async () => ({ ok: true }),
  countersigned: async () => ({ ok: true }),
  ...over,
});

describe("approvalBlocker", () => {
  it("listing de prueba (21FD0BB9): se rechaza aunque todo lo demás pase, sin preguntar a DocuSign", async () => {
    const countersigned = vi.fn(async () => ({ ok: true as const }));
    expect(await approvalBlocker(sb(true), "21fd0bb9", deps({ countersigned }))).toBe(TEST_LISTING_ERROR);
    expect(countersigned).not.toHaveBeenCalled();
  });

  it("sin poder leer el listing se trata como de prueba (falla cerrado)", async () => {
    expect(await approvalBlocker(sb(null), "x", deps())).toBe(TEST_LISTING_ERROR);
  });

  it("sobre anulado (no completed): not_countersigned", async () => {
    expect(
      await approvalBlocker(sb(false), "p1", deps({ countersigned: async () => ({ ok: false, reason: "not_countersigned" }) })),
    ).toBe("not_countersigned");
  });

  it("descripción legal y titular, en ese orden; todo bien = null", async () => {
    expect(await approvalBlocker(sb(false), "p1", deps({ pendingLegal: async () => true }))).toBe("legal_pending");
    expect(
      await approvalBlocker(sb(false), "p1", deps({ ownershipGate: async () => ({ ok: false, reason: "manual_review_pending" }) })),
    ).toBe("manual_review_pending");
    expect(await approvalBlocker(sb(false), "p1", deps())).toBeNull();
  });

  it("las dos acciones de aprobar usan approvalBlocker", () => {
    expect(readFileSync("src/app/[lang]/admin/page.tsx", "utf8")).toContain("const blocked = await approvalBlocker(supabase, id);");
    expect(readFileSync("src/app/[lang]/admin/listings/[id]/review/page.tsx", "utf8")).toContain(
      "const blocked = await approvalBlocker(supabase, id);",
    );
  });
});
