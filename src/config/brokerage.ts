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
// nombre de la broker distinto de este.
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
 * Ficha pública de cada licencia en el DBPR de Florida (myfloridalicense.com). El `id` es el
 * identificador que el DBPR asigna a la licencia, no se deriva del número: se obtiene buscando
 * el número en https://www.myfloridalicense.com/wl11.asp. Comprobadas el 2026-10-18, sin
 * sesión: CQ1075352 muestra Lixtara LLC, 181 Vera Ct, activa; BK3664191 muestra a la broker.
 * Si cambia una licencia, se buscan de nuevo.
 */
export const DBPR_BROKERAGE_LICENSE_URL =
  "https://www.myfloridalicense.com/LicenseDetail.asp?SID=&id=E3419C0BDBD9CF697EBF4272307D3E21";
export const DBPR_BROKER_LICENSE_URL =
  "https://www.myfloridalicense.com/LicenseDetail.asp?SID=&id=6A304B94CD44DC8912D08F4918D8C092";

/**
 * Correo de contacto para bajas y preguntas de la landing de propietarios (/owners): la FAQ
 * "¿Cómo dejo de recibir correos?" lo muestra. Decisión del owner (2026-10-18): una sola
 * constante, para cambiarlo después en un solo lugar.
 */
export const CONTACT_EMAIL = "camilo@lixtara.com";

/**
 * Años de experiencia en bienes raíces en Florida de Anamaria Velasquez (dato del owner,
 * 2026-10-17). Se atribuyen a ELLA; su equipo se menciona aparte, sin sumar años (decisión del
 * owner, 2026-10-18): nunca "a team with 20+ years". Es experiencia, no antigüedad de la
 * licencia de Lixtara ni de la broker: nunca escribir "licensed for 20 years". Se muestra
 * como "20+".
 */
export const BROKER_EXPERIENCE_YEARS = 20;

/**
 * Email con el que la broker de Lixtara firma CADA acuerdo en DocuSign (#137 f). Decisión
 * del owner (2026-09-28): firma Anamaria con un buzón PROPIO — solo ella lo controla, con
 * verificación en dos pasos, idealmente en el dominio lixtara.com; nunca uno genérico
 * compartido (DocuSign atribuye la firma a quien controla el email).
 *
 * Provisto por el owner (2026-10-13). Si se vuelve a null, NINGÚN acuerdo se crea: la
 * creación del sobre falla antes de llamar a DocuSign (un acuerdo con una sola firma no
 * tiene validez como listing agreement).
 */
export const BROKER_SIGNER_EMAIL: string | null = "anamaria@lixtara.com";

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

/** Primera línea del pie de los correos fríos (decisión del owner, 2026-10-18). */
export const COLD_EMAIL_AD_NOTICE = "This is an advertisement.";

/** Texto del enlace de baja; en Instantly se enlaza con su marcador de "unsubscribe". */
export const COLD_EMAIL_UNSUBSCRIBE_LABEL = "Unsubscribe";

/**
 * Pie de los correos fríos a propietarios (Instantly): licencias, dirección, aviso para quien
 * ya tiene su casa listada con otro broker y la baja. La plantilla vive en Instantly (y en el
 * generador local ~/lixtara-data/pipeline/email_template.py, que lee esta función); este es el
 * texto que se pega. El último segmento es el texto del enlace de baja.
 */
export function coldEmailFooter(): string {
  return [
    brokerageLicenseLine("en"),
    BROKERAGE.address,
    "If your property is currently listed with another broker, please disregard this message.",
    COLD_EMAIL_UNSUBSCRIBE_LABEL,
  ].join(" · ");
}

/** Variante corta para pantallas angostas (móvil, 375 px). Igual en ambos idiomas. */
export function brokerageLicenseLineShort(): string {
  return `${BROKERAGE.legalName} · FL Lic. #${BROKERAGE.brokerageLicense}`;
}

/**
 * Fills brokerage placeholders in dictionary copy so no license number or
 * broker name is ever hardcoded in i18n: {brokerageName}, {brokerageLicense}, {brokerLicense},
 * {brokerName}, {brokerFirstName}, {brokerYears}.
 */
export function fillBrokerageCopy(text: string): string {
  return text
    .replaceAll("{brokerageName}", BROKERAGE.legalName)
    .replaceAll("{brokerageLicense}", BROKERAGE.brokerageLicense)
    .replaceAll("{brokerLicense}", BROKERAGE.brokerLicense)
    .replaceAll("{brokerName}", BROKERAGE.brokerName)
    .replaceAll("{brokerYears}", String(BROKER_EXPERIENCE_YEARS))
    .replaceAll("{brokerFirstName}", BROKERAGE.brokerName.split(" ")[0]);
}
