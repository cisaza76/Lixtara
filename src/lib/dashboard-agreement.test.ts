import { describe, expect, it } from "vitest";
import { dashboardAgreementState, latestAgreementOf } from "@/lib/dashboard-agreement";
import { t } from "@/lib/i18n";

const row = (status: string, created_at: string) => ({ status, created_at });

describe("dashboardAgreementState", () => {
  it("cada estado con su nombre: anulado no es rechazado; vencido no es pendiente", () => {
    const cases: Array<[string, string, string]> = [
      ["pending", "pending", "warn"],
      ["sent", "pending", "warn"],
      ["delivered", "pending", "warn"],
      ["signed", "signed", "ok"],
      ["completed", "completed", "ok"],
      ["declined", "declined", "fail"],
      ["voided", "voided", "fail"],
      ["expired", "expired", "fail"],
    ];
    for (const [status, key, tone] of cases) {
      expect(dashboardAgreementState([row(status, "2026-10-28T10:00:00Z")]), status).toEqual({ key, tone });
    }
    expect(dashboardAgreementState([])).toEqual({ key: "none", tone: "none" });
  });

  it("decide el acuerdo más reciente: uno viejo anulado (reemplazado) no tapa al nuevo", () => {
    const old = row("voided", "2026-10-27T10:00:00Z");
    const fresh = row("sent", "2026-10-28T10:00:00Z");
    expect(dashboardAgreementState([fresh, old]).key).toBe("pending");
    expect(dashboardAgreementState([old, fresh]).key).toBe("pending");
    expect(latestAgreementOf([old, fresh])).toBe(fresh);
    // Y al revés: el último anulado gana aunque antes hubiera uno firmado.
    expect(dashboardAgreementState([row("signed", "2026-10-26T10:00:00Z"), row("voided", "2026-10-28T10:00:00Z")]).key).toBe("voided");
  });

  it("textos: 'Acuerdo anulado' / 'Agreement voided'", () => {
    expect(t("es").dashboard.agreementVoided).toBe("Acuerdo anulado");
    expect(t("en").dashboard.agreementVoided).toBe("Agreement voided");
    expect(t("es").dashboard.agreementExpired).toBe("Acuerdo vencido");
  });
});
