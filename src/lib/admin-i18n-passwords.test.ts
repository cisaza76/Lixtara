// /es/admin en español (panel, menú lateral, aviso legal, estados de pago) y minLength=8 en
// todos los campos de contraseña nueva, con la misma constante que el servidor.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dictionaries } from "@/lib/i18n";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-errors";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("admin en español", () => {
  const es = dictionaries.es.admin;
  const en = dictionaries.en.admin;

  it("las etiquetas del panel están traducidas", () => {
    expect(es.kpiPendingTasks).toBe("Tareas pendientes");
    expect(es.kpiPendingApprovals).toBe("Aprobaciones pendientes");
    expect(es.kpiActiveDeals).toBe("Operaciones activas");
    expect(es.kpiMonthRevenue).toBe("Ingresos de este mes");
    expect(es.recentActivityHeader).toBe("Actividad reciente");
    expect(es.quickActionsHeader).toBe("Acciones rápidas");
    expect(es.paymentStatuses.succeeded).toBe("Pagado");
  });

  it("ninguna etiqueta del panel ni del menú queda en inglés en ES (salvo nombres propios)", () => {
    const same = new Set(["listingIdLabel"]);
    for (const k of Object.keys(en) as Array<keyof typeof en>) {
      if (typeof en[k] !== "string" || same.has(k)) continue;
      if (/^(kpi|recent|noActivity|quick|previewPublic|legalReminder)/.test(k)) expect(es[k], k).not.toBe(en[k]);
    }
    for (const k of Object.keys(en.nav) as Array<keyof typeof en.nav>) {
      if (k === "crm" || k === "investorClub") continue;
      expect(es.nav[k], `nav.${k}`).not.toBe(en.nav[k]);
    }
    for (const k of Object.keys(en.paymentStatuses) as Array<keyof typeof en.paymentStatuses>) {
      expect(es.paymentStatuses[k], k).not.toBe(en.paymentStatuses[k]);
    }
  });

  it("el panel, el menú y el layout no tienen texto en inglés fijo", () => {
    const page = src("src/app/[lang]/admin/page.tsx");
    for (const s of ["Pending Tasks", "Pending Approvals", "Active Deals", "This Month Revenue", "Recent Activity", "Quick Actions", "No recent activity", "Preview public page", "View All Tasks", "Review Pending Listings"]) {
      expect(page, s).not.toContain(s);
    }
    expect(page).toContain("paymentStatusLabel(copy.paymentStatuses, p.status)");
    const nav = src("src/components/admin/admin-nav.tsx");
    expect(nav).not.toMatch(/title: "/);
    expect(nav).not.toContain('"Log out"');
    expect(src("src/app/[lang]/admin/layout.tsx")).not.toContain("Never provide legal advice");
  });
});

describe("minLength de contraseña", () => {
  it("es 8", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  const files = {
    "sign-up": "src/app/[lang]/sign-up/page.tsx",
    reset: "src/app/[lang]/auth/reset-password/page.tsx",
    account: "src/app/[lang]/account/page.tsx",
    "paso 7 (AccountGate)": "src/components/account-gate.tsx",
  };

  it.each(Object.entries(files))("%s: cada campo de contraseña nueva lleva minLength={PASSWORD_MIN_LENGTH}", (_name, path) => {
    const s = src(path);
    const fields = s.match(/autoComplete="new-password"/g) ?? [];
    const withMin = s.match(/minLength=\{PASSWORD_MIN_LENGTH\}/g) ?? [];
    expect(fields.length).toBeGreaterThan(0);
    expect(withMin.length).toBe(fields.length);
  });

  it("el servidor usa la misma constante (sin 8 fijo)", () => {
    for (const path of [files["sign-up"], files.reset, files.account, "src/app/[lang]/listing/new/page.tsx"]) {
      const s = src(path);
      expect(s, path).toMatch(/password\.length < PASSWORD_MIN_LENGTH/);
      expect(s, path).not.toMatch(/password\.length < \d/);
    }
  });

  it("Field pasa minLength al input", () => {
    expect(src("src/components/auth-shell.tsx")).toMatch(/minLength=\{minLength\}/);
  });

  it("sign-up, reset y /account traducen el aviso del navegador (LocalizedValidation)", () => {
    for (const path of [files["sign-up"], files.reset, files.account]) {
      expect(src(path), path).toContain("<LocalizedValidation labels={t(lang).listingForm.validation} />");
    }
  });
});
