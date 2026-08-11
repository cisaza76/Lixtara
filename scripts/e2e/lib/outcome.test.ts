import { describe, it, expect } from "vitest";
import { Recorder, classifyHttpFailure, type Outcome } from "./outcome";

describe("classifyHttpFailure — un 429 nunca se oculta como SKIP", () => {
  // Regla 8 del contrato: si el propio run agotó el limitador, es un FAIL con explicación.
  it("429 durante la ejecución → FAIL (auto-infligido)", () => {
    const r = classifyHttpFailure({ status: 429, phase: "run", step: "initiate" });
    expect(r.outcome).toBe("FAIL");
    expect(r.reason).toMatch(/rate limit/i);
    expect(r.reason).toMatch(/initiate/);
  });

  // Si la ventana ya venía consumida ANTES de empezar, el run no puede concluir nada:
  // no es un fallo del producto, es una precondición incumplida.
  it("429 en la comprobación previa → ABORT, no FAIL ni SKIP", () => {
    const r = classifyHttpFailure({ status: 429, phase: "precondition", step: "probe" });
    expect(r.outcome).toBe("ABORT");
    expect(r.reason).toMatch(/precondition/i);
  });

  it("SKIP no existe como resultado posible", () => {
    const outcomes: Outcome[] = ["PASS", "FAIL", "ABORT"];
    expect(outcomes).not.toContain("SKIP" as unknown as Outcome);
    for (const phase of ["run", "precondition"] as const) {
      expect(classifyHttpFailure({ status: 429, phase, step: "x" }).outcome).not.toBe("SKIP");
    }
  });

  it("cualquier otro status de error es FAIL en ambas fases", () => {
    for (const status of [400, 401, 403, 404, 500, 503]) {
      expect(classifyHttpFailure({ status, phase: "run", step: "s" }).outcome).toBe("FAIL");
      expect(classifyHttpFailure({ status, phase: "precondition", step: "s" }).outcome).toBe("FAIL");
    }
  });
});

describe("Recorder — agregación de los pasos del contrato", () => {
  it("todos los pasos correctos → PASS", () => {
    const rec = new Recorder();
    rec.ok("1. auth", "user 93a05487");
    rec.ok("2. listing draft", "e2e-1");
    expect(rec.outcome()).toBe("PASS");
    expect(rec.steps).toHaveLength(2);
  });

  it("un solo paso fallido → FAIL global, y se conserva el detalle", () => {
    const rec = new Recorder();
    rec.ok("1. auth");
    rec.fail("9. sha round-trip", "esperado abc, obtenido def");
    rec.ok("10. delete");
    expect(rec.outcome()).toBe("FAIL");
    expect(rec.failures().map((s) => s.name)).toEqual(["9. sha round-trip"]);
    expect(rec.failures()[0].detail).toContain("obtenido def");
  });

  it("un ABORT domina sobre los PASS previos", () => {
    const rec = new Recorder();
    rec.ok("1. auth");
    rec.abort("precondición", "ventana de rate limit residual");
    expect(rec.outcome()).toBe("ABORT");
  });

  it("un FAIL domina sobre un ABORT posterior (no se degrada un fallo real)", () => {
    const rec = new Recorder();
    rec.fail("12. lifecycle", "sigue en draft");
    rec.abort("cleanup", "no se pudo revocar");
    expect(rec.outcome()).toBe("FAIL");
  });

  it("check() registra ok/fail según la condición", () => {
    const rec = new Recorder();
    const jobsAntes: number = 33, jobsDespues: number = 33, cuotaAntes: number = 0, cuotaDespues: number = 1;
    rec.check("17. jobs sin cambios", jobsAntes === jobsDespues, "33 == 33");
    rec.check("18. cuota sin cambios", cuotaAntes === cuotaDespues, "0 != 1");
    expect(rec.outcome()).toBe("FAIL");
    expect(rec.steps.map((s) => s.status)).toEqual(["ok", "fail"]);
  });

  it("sin pasos registrados no puede declararse PASS", () => {
    expect(new Recorder().outcome()).toBe("ABORT");
  });
});
