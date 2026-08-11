// Resultado y registro de pasos del arnés E2E. Módulo PURO (sin red, sin DB, sin reloj) para
// que la regla que más fácilmente esconde problemas —la clasificación de un 429— sea testeable.
//
// NO EXISTE "SKIP". Un límite de tasa alcanzado por el propio run es un FAIL con explicación;
// una ventana ya consumida ANTES de empezar es una precondición incumplida (ABORT), porque el
// run no puede concluir nada. Clasificar cualquiera de los dos como "skip" ocultaría un
// problema real detrás de un verde.

export type Outcome = "PASS" | "FAIL" | "ABORT";
export type Phase = "precondition" | "run";
export type StepStatus = "ok" | "fail" | "abort";

export interface Step {
  name: string;
  status: StepStatus;
  detail?: string;
}

export interface HttpFailure {
  outcome: Extract<Outcome, "FAIL" | "ABORT">;
  reason: string;
}

export function classifyHttpFailure(input: { status: number; phase: Phase; step: string }): HttpFailure {
  if (input.status === 429) {
    return input.phase === "precondition"
      ? {
          outcome: "ABORT",
          reason:
            `precondition not met: rate limit ya consumido antes de empezar (paso "${input.step}"). ` +
            `El run no puede concluir nada; reintentar cuando la ventana expire.`,
        }
      : {
          outcome: "FAIL",
          reason:
            `rate limit alcanzado por el propio run en "${input.step}" (429). ` +
            `No se clasifica como skip: indica que el arnés excede el presupuesto de peticiones.`,
        };
  }
  return { outcome: "FAIL", reason: `HTTP ${input.status} en "${input.step}"` };
}

export class Recorder {
  readonly steps: Step[] = [];

  ok(name: string, detail?: string): void {
    this.steps.push({ name, status: "ok", detail });
  }
  fail(name: string, detail?: string): void {
    this.steps.push({ name, status: "fail", detail });
  }
  abort(name: string, detail?: string): void {
    this.steps.push({ name, status: "abort", detail });
  }
  // Azúcar para las aserciones del contrato: registra ok/fail según la condición.
  check(name: string, condition: boolean, detail?: string): boolean {
    this.steps.push({ name, status: condition ? "ok" : "fail", detail });
    return condition;
  }

  failures(): Step[] {
    return this.steps.filter((s) => s.status === "fail");
  }

  // Un FAIL real domina sobre un ABORT posterior: si algo ya falló, un problema de
  // precondición o de limpieza no puede degradar el veredicto a "no concluyente".
  // Sin pasos, tampoco hay PASS: no haber medido nada no es haber pasado.
  outcome(): Outcome {
    if (this.steps.length === 0) return "ABORT";
    if (this.steps.some((s) => s.status === "fail")) return "FAIL";
    if (this.steps.some((s) => s.status === "abort")) return "ABORT";
    return "PASS";
  }

  render(): string {
    const icon = { ok: "PASS", fail: "FAIL", abort: "ABORT" } as const;
    return this.steps.map((s) => `  [${icon[s.status]}] ${s.name}${s.detail ? ` — ${s.detail}` : ""}`).join("\n");
  }
}
