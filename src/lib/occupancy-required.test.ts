import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dictionaries } from "@/lib/i18n";
import { listingErrorField } from "@/lib/analytics";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("ocupación del paso 3 obligatoria (L20 del acuerdo)", () => {
  it("el select es required y su opción vacía es solo un placeholder deshabilitado", () => {
    const src = read("src/components/occupancy-section.tsx");
    expect(src).toMatch(/name="occupancy_status"[\s\S]*?required/);
    expect(src).toMatch(/<option value="" disabled>/);
    expect(src).not.toContain("notSpecifiedOption");
  });

  it("el server action rechaza el paso 3 sin ocupación válida", () => {
    const page = read("src/app/[lang]/listing/new/page.tsx");
    expect(page).toContain("if (!isOccupancyStatus(occupancyRaw)) redirect(");
    expect(page).toContain("error=occupancy_required");
    expect(page).toContain("copy.stepErrors.occupancyRequired");
  });

  it("la creación del acuerdo lo valida en el servidor (completitud lee occupancy_status)", () => {
    expect(read("src/lib/listing-completeness.server.ts")).toMatch(/FACT_COLUMNS =[\s\S]*occupancy_status/);
  });

  it("mensaje EN/ES y campo de analítica", () => {
    for (const lang of ["en", "es"] as const) {
      const d = dictionaries[lang].listingForm;
      expect(d.stepErrors.occupancyRequired.length).toBeGreaterThan(10);
      expect(d.step3.occupancyPlaceholder.length).toBeGreaterThan(3);
    }
    expect(listingErrorField("occupancy_required")).toBe("occupancy_status");
  });
});
