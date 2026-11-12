// API de Conversiones de Meta: configuración que no es secreta. El token
// (META_CAPI_TOKEN), el conjunto de datos (META_DATASET_ID) y el interruptor
// (META_CAPI_ENABLED) son variables de entorno server-only; ver meta-capi.server.ts.

/**
 * Versión de la Graph API. v26.0 es la vigente según el changelog de Meta (revisado el
 * 2026-10-31: https://developers.facebook.com/docs/graph-api/changelog/versions/). Al
 * cambiarla, revisa el changelog de la API de Conversiones.
 */
export const META_GRAPH_API_VERSION = "v26.0";

export const META_GRAPH_URL = "https://graph.facebook.com";

/**
 * La IP y el user agent guardados en ad_attribution se borran a los 90 días de guardarse o al
 * confirmarse el pago del plan (después del Purchase), lo que ocurra primero (pedido del CMO,
 * 2026-10-31). fbp, fbc y la elección quedan mientras exista la cuenta.
 */
export const AD_IP_UA_RETENTION_DAYS = 90;
