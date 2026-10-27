export type StepState = "done" | "active" | "upcoming";

/**
 * Estado de cada paso en la franja de progreso del flujo de listing. El paso actual cuenta
 * como hecho cuando su trabajo ya terminó (p. ej. el acuerdo firmado en el paso 7): así la
 * franja no lo muestra pendiente mientras el usuario solo tiene que seguir al siguiente.
 */
export function stepState(num: number, current: number, currentDone = false): StepState {
  if (num < current || (num === current && currentDone)) return "done";
  return num === current ? "active" : "upcoming";
}

/** El acuerdo cuenta como firmado por el vendedor en `signed` y en `completed` (contrafirma). */
export function agreementSignedBySeller(status: string | null | undefined): boolean {
  return status === "signed" || status === "completed";
}
