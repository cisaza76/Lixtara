// Guard de producción: mientras Production siga en la cuenta Demo de DocuSign, un listing real
// no recibe un sobre. Un contrato firmado en Demo no tiene validez (DocuSign Demo no es firma
// legal) y con él se desbloquearía el pago del paso 8. En su lugar, el paso 7 dice que el
// contrato se está preparando y la broker recibe el aviso (src/lib/contract-preparing.server.ts).
//
// Los listings is_test siguen como hoy, para probar. Fuera de Production no se bloquea nada.
// Fail-closed: en Production solo `account.docusign.com` cuenta como cuenta de producción
// (sin DOCUSIGN_AUTH_HOST, o con cualquier otro valor, se bloquea igual que con Demo).
// Se quita sola al pasar DocuSign a producción: docs/superpowers/runbooks/2026-11-10-docusign-produccion.md

export const DOCUSIGN_PRODUCTION_AUTH_HOST = "account.docusign.com";

/** ¿DOCUSIGN_AUTH_HOST es la cuenta de producción de DocuSign? */
export function docusignIsProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DOCUSIGN_AUTH_HOST ?? "").trim().toLowerCase() === DOCUSIGN_PRODUCTION_AUTH_HOST;
}

/** ¿Se bloquea el sobre de este listing? Production + DocuSign que no es de producción + no is_test. */
export function blocksRealAgreement(input: { isTest: boolean; env?: NodeJS.ProcessEnv }): boolean {
  const env = input.env ?? process.env;
  if (env.VERCEL_ENV !== "production") return false;
  if (docusignIsProduction(env)) return false;
  return !input.isTest;
}
