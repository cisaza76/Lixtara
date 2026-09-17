import { describe, it, expect, afterEach } from "vitest";
import {
  MLS_LICENSED_HOSTS,
  normalizeHost,
  isLicensedHost,
  mlsIngestDecision,
  mlsDisplayDecision,
  assertMlsIngestAllowed,
  assertMlsDisplayAllowed,
  requireMlsServerToken,
  readMlsGateEnv,
  MlsAccessDeniedError,
  type MlsGateEnv,
} from "./environment-gate";

const PROD: MlsGateEnv = { vercelEnv: "production", feedEnabled: "true" };

describe("normalizeHost", () => {
  it("normaliza mayúsculas, puerto y punto final", () => {
    expect(normalizeHost("LIXTARA.COM")).toBe("lixtara.com");
    expect(normalizeHost("lixtara.com:443")).toBe("lixtara.com");
    expect(normalizeHost("lixtara.com.")).toBe("lixtara.com");
    expect(normalizeHost("  lixtara.com  ")).toBe("lixtara.com");
  });

  it("toma el primer host de un x-forwarded-host encadenado", () => {
    expect(normalizeHost("lixtara.com, proxy.internal")).toBe("lixtara.com");
  });

  it("devuelve null cuando no hay nada utilizable", () => {
    for (const v of [null, undefined, "", "   ", ":443"]) {
      expect(normalizeHost(v)).toBeNull();
    }
  });
});

describe("isLicensedHost", () => {
  it("acepta solo el sitio nombrado en el acuerdo", () => {
    expect(isLicensedHost("lixtara.com")).toBe(true);
    expect(isLicensedHost("www.lixtara.com")).toBe(true);
  });

  it("rechaza los dominios de Vercel — ninguno está licenciado", () => {
    // Cada PR genera una URL de preview; el alias de producción tampoco es el
    // sitio del acuerdo.
    for (const h of [
      "lixtara.vercel.app",
      "lixtara-git-main-camiloisaza.vercel.app",
      "lixtara-abc123-camiloisaza-5002s-projects.vercel.app",
      "localhost",
      "lixtara.com.evil.test",   // sufijo malicioso
      "notlixtara.com",
    ]) {
      expect(isLicensedHost(h), h).toBe(false);
    }
  });
});

describe("puerta de ingesta (cron → Bridge → base de datos)", () => {
  it("permite solo en producción con el flag encendido", () => {
    expect(mlsIngestDecision(PROD)).toEqual({ allowed: true });
  });

  it("niega sin el flag — fail-closed por defecto", () => {
    expect(mlsIngestDecision({ vercelEnv: "production" }))
      .toEqual({ allowed: false, reason: "feed_disabled" });
    expect(mlsIngestDecision({ vercelEnv: "production", feedEnabled: "false" }))
      .toEqual({ allowed: false, reason: "feed_disabled" });
    // Solo el literal "true" habilita: nada de valores ambiguos.
    expect(mlsIngestDecision({ vercelEnv: "production", feedEnabled: "1" }).allowed).toBe(false);
    expect(mlsIngestDecision({ vercelEnv: "production", feedEnabled: "TRUE" }).allowed).toBe(false);
  });

  it("niega fuera de producción aunque el flag esté encendido", () => {
    for (const e of ["preview", "development", undefined, "staging"]) {
      expect(mlsIngestDecision({ vercelEnv: e, feedEnabled: "true" }))
        .toEqual({ allowed: false, reason: "not_production" });
    }
  });

  it("no exige host: el cron no llega por el dominio público", () => {
    expect(mlsIngestDecision(PROD).allowed).toBe(true);
  });
});

describe("puerta de exhibición (servir contenido del MLS)", () => {
  it("permite en producción, con flag, sobre el host licenciado", () => {
    expect(mlsDisplayDecision("lixtara.com", PROD)).toEqual({ allowed: true });
    expect(mlsDisplayDecision("www.lixtara.com:443", PROD)).toEqual({ allowed: true });
  });

  it("niega en el alias de Vercel aunque el despliegue SEA producción", () => {
    // El caso que motiva el chequeo de host: un despliegue de producción
    // responde también en lixtara.vercel.app, que no es el sitio licenciado.
    expect(mlsDisplayDecision("lixtara.vercel.app", PROD))
      .toEqual({ allowed: false, reason: "host_not_licensed" });
  });

  it("niega en cualquier URL de preview", () => {
    expect(mlsDisplayDecision("lixtara-xyz.vercel.app", { vercelEnv: "preview", feedEnabled: "true" }))
      .toEqual({ allowed: false, reason: "not_production" });
  });

  it("niega cuando no hay host", () => {
    expect(mlsDisplayDecision(null, PROD)).toEqual({ allowed: false, reason: "host_missing" });
  });

  it("es estrictamente más fuerte que la ingesta", () => {
    // Todo lo que la exhibición permite, la ingesta también.
    expect(mlsDisplayDecision("lixtara.com", PROD).allowed).toBe(true);
    expect(mlsIngestDecision(PROD).allowed).toBe(true);
    // Pero no al revés.
    expect(mlsIngestDecision(PROD).allowed).toBe(true);
    expect(mlsDisplayDecision("lixtara.vercel.app", PROD).allowed).toBe(false);
  });
});

describe("aserciones", () => {
  it("lanzan con la razón tipada y explican el porqué", () => {
    try {
      assertMlsDisplayAllowed("lixtara.vercel.app", PROD);
      expect.unreachable("debió lanzar");
    } catch (e) {
      expect(e).toBeInstanceOf(MlsAccessDeniedError);
      expect((e as MlsAccessDeniedError).reason).toBe("host_not_licensed");
      expect((e as Error).message).toContain("lixtara.com only");
    }
  });

  it("no lanzan cuando está autorizado", () => {
    expect(() => assertMlsIngestAllowed(PROD)).not.toThrow();
    expect(() => assertMlsDisplayAllowed("lixtara.com", PROD)).not.toThrow();
  });
});

describe("credencial de Bridge", () => {
  const prev = process.env.MLS_BRIDGE_SERVER_TOKEN;
  afterEach(() => {
    if (prev === undefined) delete process.env.MLS_BRIDGE_SERVER_TOKEN;
    else process.env.MLS_BRIDGE_SERVER_TOKEN = prev;
  });

  it("no se puede obtener sin pasar la puerta", () => {
    process.env.MLS_BRIDGE_SERVER_TOKEN = "tok_real";
    // Aunque el token esté puesto por error en un preview, no se entrega.
    expect(() => requireMlsServerToken({ vercelEnv: "preview", feedEnabled: "true" }))
      .toThrow(MlsAccessDeniedError);
  });

  it("falla claro si la puerta abre pero falta el token", () => {
    delete process.env.MLS_BRIDGE_SERVER_TOKEN;
    expect(() => requireMlsServerToken(PROD)).toThrow(/MLS_BRIDGE_SERVER_TOKEN is not set/);
  });

  it("entrega el token cuando todo está en regla", () => {
    process.env.MLS_BRIDGE_SERVER_TOKEN = "tok_real";
    expect(requireMlsServerToken(PROD)).toBe("tok_real");
  });

  it("nunca se expone con prefijo NEXT_PUBLIC_", () => {
    // Un NEXT_PUBLIC_ lo inlinearía en el bundle del cliente.
    expect(Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_") && k.includes("MLS")))
      .toEqual([]);
  });
});

describe("lectura del entorno real", () => {
  it("readMlsGateEnv es fail-closed en el entorno de pruebas", () => {
    // Ni VERCEL_ENV ni MLS_FEED_ENABLED están puestas al correr tests.
    expect(mlsIngestDecision(readMlsGateEnv()).allowed).toBe(false);
  });

  it("el sitio licenciado es exactamente el del acuerdo", () => {
    expect([...MLS_LICENSED_HOSTS]).toEqual(["lixtara.com", "www.lixtara.com"]);
  });
});
