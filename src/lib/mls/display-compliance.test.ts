import { describe, it, expect } from "vitest";
import {
  listingAttribution,
  mlsCopyrightNotice,
  reliabilityDisclaimer,
  displayEligibility,
  syncIntervalMeetsContract,
  PUBLICLY_DISPLAYABLE_STATUSES,
  ATTRIBUTION_TYPOGRAPHY,
  MAX_REFRESH_INTERVAL_HOURS,
  MAX_WITHDRAWAL_LATENCY_HOURS,
  OWN_BROKERAGE_NAME,
} from "./display-compliance";

describe("atribución al listing broker (Schedule A §9)", () => {
  it("atribuye los listings de terceros con el texto exigido", () => {
    const a = listingAttribution(
      { listOfficeName: "Acme Realty", isOwnBrokerage: false }, "en");
    expect(a.courtesyLine).toBe("This listing is courtesy of Acme Realty.");
  });

  it("traduce la línea al español", () => {
    const a = listingAttribution(
      { listOfficeName: "Acme Realty", isOwnBrokerage: false }, "es");
    expect(a.courtesyLine).toBe("Este listado es cortesía de Acme Realty.");
  });

  it("NO atribuye los listings propios", () => {
    // La obligación aplica a listings que NO están contratados con nuestra correduría.
    // Atribuirnos a nosotros mismos sería incorrecto, no solo redundante.
    const a = listingAttribution(
      { listOfficeName: OWN_BROKERAGE_NAME, isOwnBrokerage: true }, "en");
    expect(a.courtesyLine).toBeNull();
    expect(a.extraFields).toEqual([]);
  });

  it("sin nombre de oficina degrada a texto genérico, nunca omite la línea", () => {
    // Omitir la atribución ES el incumplimiento. Un nombre ausente no puede provocarlo.
    for (const v of [null, "", "   "]) {
      const a = listingAttribution({ listOfficeName: v, isOwnBrokerage: false }, "en");
      expect(a.courtesyLine).toBe("This listing is courtesy of another real estate firm.");
    }
  });

  it("incluye los campos extra que el feed traiga", () => {
    const a = listingAttribution({
      listOfficeName: "Acme Realty", listAgentName: "Jane Agent",
      listOfficePhone: "305-555-0100", listAgentEmail: "jane@acme.test",
      isOwnBrokerage: false,
    }, "en");
    expect(a.extraFields).toEqual(["Jane Agent", "305-555-0100", "jane@acme.test"]);
  });

  it("no inventa campos extra que el feed no trae", () => {
    const a = listingAttribution({
      listOfficeName: "Acme Realty", listAgentName: null, listOfficePhone: "  ",
      isOwnBrokerage: false,
    }, "en");
    expect(a.extraFields).toEqual([]);
  });

  it("la tipografía de la atribución NO es letra chica", () => {
    // Schedule A §9: no menor que la mediana usada en la ficha. `text-xs` es lo que
    // pondría cualquiera por instinto de diseño y sería un incumplimiento.
    expect(ATTRIBUTION_TYPOGRAPHY).not.toContain("text-xs");
    expect(ATTRIBUTION_TYPOGRAPHY).not.toContain("text-[10px]");
    expect(ATTRIBUTION_TYPOGRAPHY).toContain("text-sm");
  });
});

describe("aviso de copyright (Schedule A §10 / Schedule C §3)", () => {
  it("lleva el texto literal que exige el acuerdo", () => {
    const t = mlsCopyrightNotice(2026);
    expect(t).toContain("Copyright Southeast Florida MLS a/k/a SEFMLS © 2026");
    expect(t).toContain("Accuracy of listing information is not guaranteed");
    expect(t).toContain("personal consumer, non-commercial use");
    expect(t).toContain("All other use is strictly prohibited");
  });

  it("el año es parámetro — uno quemado quedaría obsoleto el 1 de enero", () => {
    expect(mlsCopyrightNotice(2027)).toContain("© 2027");
  });
});

describe("disclaimer de fiabilidad (Schedule C §2)", () => {
  it("nombra a MIAMI REALTORS® en ambos idiomas", () => {
    expect(reliabilityDisclaimer("en")).toContain("MIAMI REALTORS®");
    expect(reliabilityDisclaimer("en")).toContain("deemed reliable");
    expect(reliabilityDisclaimer("es")).toContain("MIAMI REALTORS®");
    expect(reliabilityDisclaimer("es")).toContain("confiable");
  });
});

describe("elegibilidad de exhibición", () => {
  it("permite los estados públicos de IDX", () => {
    for (const s of PUBLICLY_DISPLAYABLE_STATUSES) {
      expect(displayEligibility({ mlsStatus: s, withdrawnAt: null }).displayable, s).toBe(true);
    }
  });

  it("bloquea lo retirado — Schedule A exige sacarlo en 24h", () => {
    const r = displayEligibility({ mlsStatus: "Active", withdrawnAt: "2026-09-16T10:00:00Z" });
    expect(r).toEqual({ displayable: false, reason: "withdrawn" });
  });

  it("bloquea Closed en el buscador público", () => {
    // MIAMI confirmó que los vendidos pueden mostrarse, pero eso es para comparables del
    // vendedor. Mezclar casas vendidas entre las disponibles engaña al comprador.
    expect(displayEligibility({ mlsStatus: "Closed", withdrawnAt: null }))
      .toEqual({ displayable: false, reason: "not_displayable" });
  });

  it("bloquea estados desconocidos por defecto", () => {
    for (const s of ["Expired", "Withdrawn", "Canceled", "Hold", ""]) {
      expect(displayEligibility({ mlsStatus: s, withdrawnAt: null }).displayable, s).toBe(false);
    }
  });
});

describe("plazos del contrato", () => {
  it("el refresco mínimo son 24 horas, no 15 minutos", () => {
    expect(MAX_REFRESH_INTERVAL_HOURS).toBe(24);
    expect(MAX_WITHDRAWAL_LATENCY_HOURS).toBe(24);
  });

  it("el cron de 6 horas cumple", () => {
    expect(syncIntervalMeetsContract(6)).toBe(true);
  });

  it("un intervalo mayor a 24h incumple", () => {
    // Existe para que cambiar el cron a algo que incumpla rompa un test en vez de pasar
    // inadvertido hasta que MIAMI lo note.
    expect(syncIntervalMeetsContract(25)).toBe(false);
    expect(syncIntervalMeetsContract(48)).toBe(false);
    expect(syncIntervalMeetsContract(0)).toBe(false);
  });
});
