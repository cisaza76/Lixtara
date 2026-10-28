// Etiqueta del acuerdo en el dashboard del vendedor. Puro: decide con el acuerdo más reciente del
// listing (uno anulado porque se reemplazó por otro no cuenta) y nombra cada estado por lo que es.
// Antes, cualquier acuerdo viejo anulado o rechazado ganaba, "voided" decía "rechazado" y
// "expired" caía en "pendiente".

export type DashboardAgreementKey =
  | "none"
  | "pending"
  | "signed"
  | "completed"
  | "declined"
  | "voided"
  | "expired";

export type DashboardAgreementTone = "ok" | "warn" | "fail" | "none";

export interface DashboardAgreementRow {
  status: string;
  created_at?: string | null;
}

const TONE: Record<DashboardAgreementKey, DashboardAgreementTone> = {
  none: "none",
  pending: "warn",
  signed: "ok",
  completed: "ok",
  declined: "fail",
  voided: "fail",
  expired: "fail",
};

/** El acuerdo más reciente (por created_at; sin fecha, el último de la lista). */
export function latestAgreementOf<T extends DashboardAgreementRow>(agreements: T[]): T | null {
  let latest: T | null = null;
  for (const a of agreements) {
    if (!latest || (a.created_at ?? "") >= (latest.created_at ?? "")) latest = a;
  }
  return latest;
}

/** Estado del acuerdo, para el dashboard: pending/sent/delivered = pendiente de firmas. */
export function dashboardAgreementState(agreements: DashboardAgreementRow[]): {
  key: DashboardAgreementKey;
  tone: DashboardAgreementTone;
} {
  const latest = latestAgreementOf(agreements);
  const key: DashboardAgreementKey = !latest
    ? "none"
    : latest.status === "signed" ||
        latest.status === "completed" ||
        latest.status === "declined" ||
        latest.status === "voided" ||
        latest.status === "expired"
      ? latest.status
      : "pending";
  return { key, tone: TONE[key] };
}
