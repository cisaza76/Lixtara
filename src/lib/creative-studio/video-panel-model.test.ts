import { describe, expect, it } from "vitest";
import { deriveFailedViewModel } from "@/lib/creative-studio/video-panel-model";
import type { SellerFailureDto } from "@/lib/creative-studio/seller-video-status";

// UX 5C — the approved CTA matrix as a PURE view-model (the React panel only renders
// it). Never a dead CTA: retry appears only when it is both useful and possible.
const f = (over: Partial<SellerFailureDto> = {}): SellerFailureDto => ({
  kind: "technical_retryable",
  reference: "A7F31C2D",
  canRetry: true,
  supportPrimary: false,
  ...over,
});

describe("deriveFailedViewModel", () => {
  it("technical retryable, first failure: retry primary, support secondary", () => {
    const vm = deriveFailedViewModel(f());
    expect(vm).toMatchObject({ primary: "retry", secondary: "support", detailKey: "errorDetail", showReference: true });
  });

  it("source action required: replace primary, support secondary, NO retry anywhere", () => {
    const vm = deriveFailedViewModel(f({ kind: "source_action_required", canRetry: false }));
    expect(vm).toMatchObject({ primary: "replace", secondary: "support", headingKey: "sourceErrorHeading", detailKey: "sourceErrorDetail" });
    expect([vm.primary, vm.secondary]).not.toContain("retry");
  });

  it("repeat technical failure (still retryable): support primary, retry demoted to secondary", () => {
    const vm = deriveFailedViewModel(f({ supportPrimary: true, canRetry: true }));
    expect(vm).toMatchObject({ primary: "support", secondary: "retry" });
  });

  it("technical support / exhausted capacity: support only — retry disappears", () => {
    for (const dto of [f({ kind: "technical_support", canRetry: false, supportPrimary: true }), f({ canRetry: false, supportPrimary: true })]) {
      const vm = deriveFailedViewModel(dto);
      expect(vm.primary).toBe("support");
      expect(vm.secondary).toBeNull();
      expect(vm.detailKey).toBe("supportErrorDetail");
    }
  });

  it("no failure info (legacy/degraded response): current behavior — retry primary", () => {
    const vm = deriveFailedViewModel(undefined);
    expect(vm).toMatchObject({ primary: "retry", secondary: "support", showReference: false });
  });
});

describe("Etapa 1 — el detalle del panel distingue las cuatro causas de source", () => {
  const vm = (sourceIssue: string) =>
    deriveFailedViewModel({ kind: "source_action_required", sourceIssue, reference: "A1", canRetry: false, supportPrimary: false } as SellerFailureDto);

  it("cada causa tiene su propio mensaje", () => {
    expect(vm("container").detailKey).toBe("sourceErrorContainer");
    expect(vm("codec").detailKey).toBe("sourceErrorCodec");
    expect(vm("hdr").detailKey).toBe("sourceErrorHdr");
    expect(vm("corrupt").detailKey).toBe("sourceErrorCorrupt");
  });
  it("una causa desconocida cae al genérico y NUNCA ofrece retry", () => {
    expect(vm("other").detailKey).toBe("sourceErrorDetail");
    expect(vm("other").primary).toBe("replace");
  });
});

// ---- Fallo PRE-JOB (readiness / proveedor) — incidente 2026-08-11 ----------------------
// Un fallo anterior a createJob no tiene `failure` en el DTO de estado, así que la matriz
// de UX 5C no aplica. Lo importante: si el fallo es determinístico, la UI NO puede decir
// "trying again usually works" ni ofrecer Try again como acción principal.
import { derivePreflightViewModel } from "./video-panel-model";

describe("derivePreflightViewModel", () => {
  it("determinístico: sin promesa de reintento y sin retry como CTA primario", () => {
    const vm = derivePreflightViewModel({ retryable: false, reference: "A1B2C3D4" });
    expect(vm.detailKey).not.toBe("errorDetail"); // el copy de "suele funcionar" queda prohibido
    expect(vm.primary).not.toBe("retry");
    expect(vm.showRetry).toBe(false);
    expect(vm.reference).toBe("A1B2C3D4");
  });

  it("transitorio: sí ofrece reintentar", () => {
    const vm = derivePreflightViewModel({ retryable: true, reference: "FFFFFFFF" });
    expect(vm.showRetry).toBe(true);
    expect(vm.primary).toBe("retry");
    expect(vm.detailKey).toBe("errorDetailTransient");
  });

  it("sin información se trata como determinístico (no prometer de más)", () => {
    const vm = derivePreflightViewModel(null);
    expect(vm.showRetry).toBe(false);
    expect(vm.primary).toBe("support");
  });

  it("nunca expone proveedor, modelo ni códigos internos", () => {
    const payload = JSON.stringify(derivePreflightViewModel({ retryable: false, reference: "DEADBEEF" }));
    expect(payload).not.toMatch(/anthropic|claude|vision|8000|px|photo_analysis/i);
  });
});
