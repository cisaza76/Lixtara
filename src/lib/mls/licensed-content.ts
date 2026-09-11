// Marca de tipo para el contenido licenciado del MLS.
//
// § III.B.4 del acuerdo de MIAMI AOR prohíbe alimentar Licensed Content
// "directly or indirectly, to any generative artificial intelligence model
// ... including ... chatbots, for any purpose, including ... machine processing".
//
// Lixtara tiene cuatro superficies de IA (Loui, Media Intelligence, staging con
// Luma, tours con Gemini). El riesgo real no es que un módulo de IA importe el
// de MLS — eso lo atrapa `ai-boundary.test.ts` — sino que alguien lea filas del
// MLS en una ruta y las meta en un prompt. Contra eso, el tipo.
//
// CÓMO SE USA (cuando exista el lector del feed):
//   - El repositorio de MLS devuelve SIEMPRE `MlsLicensed<T>`.
//   - Las funciones que arman prompts aceptan `AiSafe<T>`, que colapsa a `never`
//     ante un valor marcado → error de compilación en el punto de la fuga.
//   - Mostrarlo en una página es un uso PERMITIDO: para eso está
//     `declassifyForDisplay()`, el único camino de salida y fácil de auditar.

declare const MLS_LICENSED: unique symbol;

/** Un valor que proviene del feed del MLS y está sujeto al § III.B.4. */
export type MlsLicensed<T> = T & { readonly [MLS_LICENSED]: true };

/**
 * Colapsa a `never` si `T` lleva la marca del MLS. Las firmas que envían texto
 * a un modelo deben tipar sus parámetros con esto.
 */
export type AiSafe<T> = T extends { readonly [MLS_LICENSED]: true } ? never : T;

/**
 * Aplica la marca. Debe llamarse en UN solo sitio — el lector del feed — para
 * que todo lo que salga de ahí quede teñido.
 */
export function markAsMlsLicensed<T>(value: T): MlsLicensed<T> {
  return value as MlsLicensed<T>;
}

/**
 * Quita la marca para EXHIBIR en el sitio licenciado. Mostrar es un uso
 * autorizado (§ III.A); alimentar un modelo no lo es.
 *
 * Nunca llames a esto en un camino que termine en una llamada a IA. Cada uso
 * debería ser visible en revisión: si aparece dentro de `lib/ai.ts`,
 * `loui-prompt.ts`, `media-intelligence/`, `staging.ts`, `luma.ts` o
 * `tour/processors/`, es una violación del acuerdo.
 */
export function declassifyForDisplay<T>(value: MlsLicensed<T>): T {
  return value as T;
}
