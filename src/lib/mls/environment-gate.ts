// Puerta de entorno para el contenido licenciado del MLS.
//
// POR QUÉ EXISTE
// El acuerdo de datos de MIAMI AOR autoriza el Data Feed para UN solo sitio:
//   Schedule B §1 — "This is the ONLY Website authorized to receive the Data Feed."
//   §IX.J        — "...place the Licensed Content on one (1) single Website,
//                   specifically named in this Agreement."
// MIAMI confirmó por escrito (Benjamin Costa, 2026-09-09) que los entornos no
// públicos no hay que declararlos, y que restringir el feed a producción es el
// enfoque correcto. Este módulo lo hace cumplir en código en vez de por
// disciplina: el despliegue de Vercel produce una URL de preview por cada PR, y
// ninguna de ellas está licenciada.
//
// DOS CAMINOS, DOS PUERTAS
// El contrato distingue dónde llega el FEED de dónde ocurre la EXHIBICIÓN, y el
// worker de sincronización no entra por el dominio público:
//
//   Ingesta   (cron → Bridge API → base de datos)
//             producción + MLS_SYNC_ENABLED. SIN chequeo de host: una invocación
//             de Vercel Cron no llega por lixtara.com.
//
//   Exhibición (páginas que sirven contenido del MLS)
//             producción + MLS_DISPLAY_ENABLED + el host DEBE ser el sitio
//             licenciado.
//
// DOS INTERRUPTORES, NO UNO
// Antes un solo MLS_FEED_ENABLED abría las dos puertas a la vez, así que era
// imposible llenar la tabla y revisarla (p. ej. el `Media` del payload real) antes
// de publicar nada en lixtara.com. Ahora cada puerta tiene su flag. La exhibición
// NO depende del flag de sincronización: son decisiones independientes, y apagar la
// sincronización no debe tumbar la página (los datos ya ingeridos siguen vigentes
// hasta 24 h; el plazo lo vigila la operación, no este módulo).
//
// COMPATIBILIDAD: si un flag nuevo no está definido, se usa MLS_FEED_ENABLED. Un
// entorno que solo tenga el flag viejo se comporta exactamente como antes. En
// cuanto un flag nuevo está definido —con cualquier valor— manda él.
//
// Módulo PURO: sin I/O, entorno inyectable. Fail-closed en todos los caminos —
// si no puede demostrar que está autorizado, niega.

/** El único sitio nombrado en el acuerdo. `www` incluido por la redirección. */
export const MLS_LICENSED_HOSTS = ["lixtara.com", "www.lixtara.com"] as const;

export type MlsDenialReason =
  | "sync_disabled"     // MLS_SYNC_ENABLED (o el flag viejo) apagado o ausente
  | "display_disabled"  // MLS_DISPLAY_ENABLED (o el flag viejo) apagado o ausente
  | "not_production"    // preview, development o entorno desconocido
  | "host_missing"      // no se pudo determinar el host de la petición
  | "host_not_licensed"; // host real, pero no es el sitio del acuerdo

export interface MlsGateEnv {
  /** `process.env.VERCEL_ENV` — "production" | "preview" | "development". */
  vercelEnv?: string;
  /** `process.env.MLS_SYNC_ENABLED` — "true" habilita la ingesta. */
  syncEnabled?: string;
  /** `process.env.MLS_DISPLAY_ENABLED` — "true" habilita la exhibición. */
  displayEnabled?: string;
  /**
   * `process.env.MLS_FEED_ENABLED` — flag VIEJO, anterior a la separación. Solo se
   * consulta cuando el flag nuevo correspondiente no está definido.
   */
  feedEnabled?: string;
}

export interface MlsGateDecision {
  allowed: boolean;
  reason?: MlsDenialReason;
}

const ALLOW: MlsGateDecision = { allowed: true };
const deny = (reason: MlsDenialReason): MlsGateDecision => ({ allowed: false, reason });

/** Lee el entorno real. Aislado para que el resto del módulo siga siendo puro. */
export function readMlsGateEnv(): MlsGateEnv {
  return {
    vercelEnv: process.env.VERCEL_ENV,
    syncEnabled: process.env.MLS_SYNC_ENABLED,
    displayEnabled: process.env.MLS_DISPLAY_ENABLED,
    feedEnabled: process.env.MLS_FEED_ENABLED,
  };
}

/**
 * Resuelve un flag nuevo con retrocompatibilidad. Definido (aunque sea "false" o "")
 * → manda él. Ausente → hereda el flag viejo. Solo el literal "true" abre.
 */
function flagOn(nuevo: string | undefined, viejo: string | undefined): boolean {
  return (nuevo !== undefined ? nuevo : viejo) === "true";
}

export function mlsSyncFlagOn(env: MlsGateEnv): boolean {
  return flagOn(env.syncEnabled, env.feedEnabled);
}

export function mlsDisplayFlagOn(env: MlsGateEnv): boolean {
  return flagOn(env.displayEnabled, env.feedEnabled);
}

/**
 * Normaliza un host para comparar: minúsculas, sin puerto, sin punto final.
 * Devuelve null si no queda nada utilizable.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Un x-forwarded-host encadenado trae "a, b" — el primero es el original.
  const first = raw.split(",")[0]?.trim() ?? "";
  const noPort = first.replace(/:\d+$/, "");
  const clean = noPort.replace(/\.$/, "").toLowerCase();
  return clean.length > 0 ? clean : null;
}

export function isLicensedHost(raw: string | null | undefined): boolean {
  const host = normalizeHost(raw);
  return host !== null && (MLS_LICENSED_HOSTS as readonly string[]).includes(host);
}

/**
 * Ingesta: traer contenido licenciado desde Bridge y persistirlo.
 * Producción + MLS_SYNC_ENABLED. El host no aplica — el cron no entra por el dominio.
 */
export function mlsIngestDecision(env: MlsGateEnv): MlsGateDecision {
  if (!mlsSyncFlagOn(env)) return deny("sync_disabled");
  if (env.vercelEnv !== "production") return deny("not_production");
  return ALLOW;
}

/**
 * Exhibición: servir contenido licenciado en una respuesta.
 * Producción + MLS_DISPLAY_ENABLED + que el host sea el sitio del acuerdo. NO mira el
 * flag de sincronización — ver "DOS INTERRUPTORES" arriba.
 */
export function mlsDisplayDecision(
  host: string | null | undefined,
  env: MlsGateEnv,
): MlsGateDecision {
  if (!mlsDisplayFlagOn(env)) return deny("display_disabled");
  if (env.vercelEnv !== "production") return deny("not_production");
  if (normalizeHost(host) === null) return deny("host_missing");
  if (!isLicensedHost(host)) return deny("host_not_licensed");
  return ALLOW;
}

export class MlsAccessDeniedError extends Error {
  readonly reason: MlsDenialReason;
  constructor(reason: MlsDenialReason, context?: string) {
    super(
      `MLS licensed content is not available here (${reason})` +
      (context ? `: ${context}` : "") +
      ". The MIAMI AOR agreement authorizes the Data Feed for lixtara.com only.",
    );
    this.name = "MlsAccessDeniedError";
    this.reason = reason;
  }
}

export function assertMlsIngestAllowed(env: MlsGateEnv = readMlsGateEnv()): void {
  const d = mlsIngestDecision(env);
  if (!d.allowed) throw new MlsAccessDeniedError(d.reason!, "ingest");
}

export function assertMlsDisplayAllowed(
  host: string | null | undefined,
  env: MlsGateEnv = readMlsGateEnv(),
): void {
  const d = mlsDisplayDecision(host, env);
  if (!d.allowed) throw new MlsAccessDeniedError(d.reason!, "display");
}

/**
 * Token de servidor de Bridge. Pasa por la puerta de INGESTA (solo MLS_SYNC_ENABLED;
 * el flag de exhibición no la abre): obtener la credencial es imposible sin estar
 * autorizado, así que un preview no puede
 * llamar a Bridge ni siquiera si la variable quedara puesta por error.
 * NUNCA con prefijo NEXT_PUBLIC_ — jamás debe entrar al bundle del cliente.
 */
export function requireMlsServerToken(env: MlsGateEnv = readMlsGateEnv()): string {
  assertMlsIngestAllowed(env);
  const token = process.env.MLS_BRIDGE_SERVER_TOKEN;
  if (!token || token.trim().length === 0) {
    throw new MlsAccessDeniedError("sync_disabled", "MLS_BRIDGE_SERVER_TOKEN is not set");
  }
  return token;
}
