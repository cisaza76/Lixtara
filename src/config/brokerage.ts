// Datos de la correduría y de su broker. ÚNICA fuente para cualquier texto que muestre una
// licencia: pie de página, emails, acuerdos, avisos legales.
//
// Verificados en el DBPR de Florida el 2026-09-27:
//   Lixtara LLC — Real Estate Corporation — CQ1075352 — Active — vence 2028-09-30
//   Anamaria Velasquez — Broker — BK3664191 — Active — vence 2027-09-30
//   Dirección registrada de la correduría: 181 Vera Ct, Miami, FL 33143
//
// Si cambia cualquiera de estos datos en el DBPR, se cambia AQUÍ y en ningún otro sitio:
// src/config/brokerage.test.ts falla si aparece en el código otro número de licencia, o un
// nombre del broker distinto de este.
//
// Nunca usar el número de la antigua licencia de Nexxos Realty (el test lo impide).

export const BROKERAGE = {
  legalName: "Lixtara LLC",
  brokerageLicense: "CQ1075352",
  brokerName: "Anamaria Velasquez",
  brokerLicense: "BK3664191",
  address: "181 Vera Ct, Miami, FL 33143",
} as const;

/**
 * Email con el que la broker de Lixtara firma CADA acuerdo en DocuSign (#137 f). Decisión
 * del owner (2026-09-28): firma Anamaria con un buzón PROPIO — solo ella lo controla, con
 * verificación en dos pasos, idealmente en el dominio lixtara.com; nunca uno genérico
 * compartido (DocuSign atribuye la firma a quien controla el email).
 *
 * PENDIENTE: el owner debe proveerlo. Mientras sea null, NINGÚN acuerdo se crea: la
 * creación del sobre falla antes de llamar a DocuSign (un acuerdo con una sola firma no
 * tiene validez como listing agreement).
 */
export const BROKER_SIGNER_EMAIL: string | null = null;

/** Firmante broker de Lixtara: nombre del DBPR + email de firma, o null si falta el email. */
export function brokerSigner(): { name: string; email: string } | null {
  return BROKER_SIGNER_EMAIL ? { name: BROKERAGE.brokerName, email: BROKER_SIGNER_EMAIL } : null;
}

/** Vencimientos según el DBPR (2026-09-27). Revisar antes de cada fecha. */
export const LICENSE_EXPIRATIONS = {
  brokerageLicense: "2028-09-30",
  brokerLicense: "2027-09-30",
} as const;

type Lang = "en" | "es";

/** Línea de licencias completa para el pie de página y los emails. */
export function brokerageLicenseLine(lang: Lang): string {
  const b = BROKERAGE;
  return lang === "es"
    ? `${b.legalName} · Brokerage inmobiliaria licenciada · FL #${b.brokerageLicense} · ${b.brokerName}, Broker · FL #${b.brokerLicense}`
    : `${b.legalName} · Licensed Real Estate Brokerage · FL #${b.brokerageLicense} · ${b.brokerName}, Broker · FL #${b.brokerLicense}`;
}

/** Variante corta para pantallas angostas (móvil, 375 px). Igual en ambos idiomas. */
export function brokerageLicenseLineShort(): string {
  return `${BROKERAGE.legalName} · FL Lic. #${BROKERAGE.brokerageLicense}`;
}
