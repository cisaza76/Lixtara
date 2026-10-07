import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BROKERAGE,
  BROKER_SIGNER_EMAIL,
  brokerSigner,
  brokerageLicenseLine,
  brokerageLicenseLineShort,
} from "./brokerage";

// Datos de licencia: verificados en el DBPR el 2026-09-27. Un error aquí es un problema
// legal (Florida Statute 475 / 61J2-10.025), no de estilo.
const ROOT = resolve(__dirname, "../..");

/** Archivos versionados del repo (lo que se publica), con su contenido. */
function archivosDelRepo(): Array<{ path: string; text: string }> {
  const lista = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter((p) => p.length > 0 && !/\.(png|jpe?g|gif|webp|ico|mp4|mov|pdf|woff2?|ttf|lock)$/i.test(p));
  return lista.map((path) => {
    try {
      return { path, text: readFileSync(resolve(ROOT, path), "utf8") };
    } catch {
      return { path, text: "" };
    }
  });
}

describe("config/brokerage — datos verificados en el DBPR", () => {
  it("coincide con el registro del DBPR (2026-09-27)", () => {
    expect(BROKERAGE).toEqual({
      legalName: "Lixtara LLC",
      brokerageLicense: "CQ1075352",
      brokerName: "Anamaria Velasquez",
      brokerLicense: "BK3664191",
      address: "181 Vera Ct, Miami, FL 33143",
    });
  });

  it("pie de página EN, ES y variante corta, literales", () => {
    expect(brokerageLicenseLine("en")).toBe(
      "Lixtara LLC · Licensed Real Estate Brokerage · FL #CQ1075352 · Anamaria Velasquez, Broker · FL #BK3664191");
    expect(brokerageLicenseLine("es")).toBe(
      "Lixtara LLC · Brokerage inmobiliaria licenciada · FL #CQ1075352 · Anamaria Velasquez, Broker · FL #BK3664191");
    expect(brokerageLicenseLineShort()).toBe("Lixtara LLC · FL Lic. #CQ1075352");
  });
});

describe("el repo no contiene licencias incorrectas", () => {
  const archivos = archivosDelRepo();

  it("el escáner lee el repo de verdad (no pasa en vacío)", () => {
    expect(archivos.length).toBeGreaterThan(200);
    expect(archivos.some((a) => a.text.includes(BROKERAGE.brokerageLicense))).toBe(true);
  });

  it("no aparece el número de la antigua licencia de Nexxos Realty", () => {
    // Se arma por partes para que este mismo archivo no lo contenga.
    const viejo = ["316", "6173"].join("");
    const culpables = archivos.filter((a) => a.text.includes(viejo)).map((a) => a.path);
    expect(culpables).toEqual([]);
  });

  it("todo número de licencia de Florida (CQ/BK + 7 dígitos) es uno de los verificados", () => {
    const validos = new Set<string>([BROKERAGE.brokerageLicense, BROKERAGE.brokerLicense]);
    const otros: string[] = [];
    for (const a of archivos) {
      for (const m of a.text.matchAll(/\b(?:CQ|BK|SL)\d{7}\b/g)) {
        if (!validos.has(m[0])) otros.push(`${a.path}: ${m[0]}`);
      }
    }
    expect(otros).toEqual([]);
  });

  it("el broker se nombra como consta en el DBPR", () => {
    // "Ana Maria" en testimonios de clientes es una cita y se deja; lo que no puede
    // aparecer es otra grafía del nombre completo del broker.
    const malos: string[] = [];
    for (const a of archivos.filter((x) => x.path.startsWith("src/"))) {
      for (const m of a.text.matchAll(/\bAna\s?[Mm]aria\s+Vel[aá]squez\b/g)) {
        if (m[0] !== BROKERAGE.brokerName) malos.push(`${a.path}: ${m[0]}`);
      }
    }
    expect(malos).toEqual([]);
  });
});

describe("firmante broker en DocuSign (#137 f)", () => {
  it("si está configurado, es un buzón personal válido (no genérico compartido)", () => {
    if (BROKER_SIGNER_EMAIL === null) {
      expect(brokerSigner()).toBeNull(); // pendiente: ningún acuerdo sale sin su firma
      return;
    }
    expect(BROKER_SIGNER_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);
    expect(BROKER_SIGNER_EMAIL.split("@")[0].toLowerCase()).not.toMatch(
      /^(info|admin|contact|contacto|hello|hola|support|soporte|office|team|sales|ventas|broker|brokers|noreply|no-reply)$/,
    );
    expect(brokerSigner()).toEqual({ name: BROKERAGE.brokerName, email: BROKER_SIGNER_EMAIL });
  });
});
