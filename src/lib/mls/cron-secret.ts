// Verificación del secreto de Vercel Cron para las rutas del MLS (/api/mls/sync y
// /api/mls/reconcile). Mismo criterio que el worker de video.
import { timingSafeEqual } from "node:crypto";

/**
 * Comparación en tiempo constante del VALOR. El pre-chequeo de longitud es la desviación
 * estándar del patrón (timingSafeEqual de Node lanza con buffers de distinto tamaño): solo
 * filtra si las longitudes difieren, nunca qué caracteres coinciden. Todo fallo devuelve el
 * mismo 401 — nunca se revela si faltaba la cabecera, si el valor era otro, o si la
 * variable no está configurada.
 */
export function verifyCronSecret(req: Request): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false; // fail-closed: nunca "abierto" por omisión

  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;

  const a = Buffer.from(presented);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function intEnv(name: string, def: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}
