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
//             producción + flag. SIN chequeo de host: una invocación de Vercel
//             Cron no llega por lixtara.com.
//
//   Exhibición (páginas que sirven contenido del MLS)
//             producción + flag + el host DEBE ser el sitio licenciado.
//             Estrictamente más fuerte que la ingesta.
//
// Módulo PURO: sin I/O, entorno inyectable. Fail-closed en todos los caminos —
// si no puede demostrar que está autorizado, niega.

/** El único sitio nombrado en el acuerdo. `www` incluido por la redirección. */
export const MLS_LICENSED_HOSTS = ["lixtara.com", "www.lixtara.com"] as const;

export type MlsDenialReason =
  | "feed_disabled"     // el kill switch está apagado o ausente
  | "not_production"    // preview, development o entorno desconocido
  | "host_missing"      // no se pudo determinar el host de la petición
  | "host_not_licensed"; // host real, pero no es el sitio del acuerdo

export interface MlsGateEnv {
  /** `process.env.VERCEL_ENV` — "production" | "preview" | "development". */
  vercelEnv?: string;
  /** `process.env.MLS_FEED_ENABLED` — "true" habilita. Ausente = cerrado. */
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
    feedEnabled: process.env.MLS_FEED_ENABLED,
  };
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
 * Producción + flag. El host no aplica — el cron no entra por el dominio.
 */
export function mlsIngestDecision(env: MlsGateEnv): MlsGateDecision {
  if (env.feedEnabled !== "true") return deny("feed_disabled");
  if (env.vercelEnv !== "production") return deny("not_production");
  return ALLOW;
}

/**
 * Exhibición: servir contenido licenciado en una respuesta.
 * Todo lo de la ingesta MÁS que el host sea el sitio del acuerdo.
 */
export function mlsDisplayDecision(
  host: string | null | undefined,
  env: MlsGateEnv,
): MlsGateDecision {
  const ingest = mlsIngestDecision(env);
  if (!ingest.allowed) return ingest;
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
 * Token de servidor de Bridge. Pasa por la puerta a propósito: obtener la
 * credencial es imposible sin estar autorizado, así que un preview no puede
 * llamar a Bridge ni siquiera si la variable quedara puesta por error.
 * NUNCA con prefijo NEXT_PUBLIC_ — jamás debe entrar al bundle del cliente.
 */
export function requireMlsServerToken(env: MlsGateEnv = readMlsGateEnv()): string {
  assertMlsIngestAllowed(env);
  const token = process.env.MLS_BRIDGE_SERVER_TOKEN;
  if (!token || token.trim().length === 0) {
    throw new MlsAccessDeniedError("feed_disabled", "MLS_BRIDGE_SERVER_TOKEN is not set");
  }
  return token;
}
