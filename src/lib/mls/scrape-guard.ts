// Anti-scraping del contenido licenciado del MLS (Schedule A §1: "employ reasonable efforts
// to monitor for and prevent scraping").
//
// QUÉ CUENTA: cada render de una página pública con fichas del feed (hoy, /[lang]/properties
// en EN y ES, incluidas sus peticiones RSC). Es la ÚNICA superficie pública que devuelve
// fichas del feed; las demás lecturas de mls_listings son de staff, de cron con secreto, o
// no devuelven contenido.
//
// DOS VENTANAS por cliente:
//   - corta: MLS_VIEWS_PER_5_MIN vistas en 5 minutos (ráfagas);
//   - diaria: MLS_VIEWS_PER_DAY vistas en 24 h. Sin ella, una sola IP dentro del límite
//     corto podría bajar el feed entero (~50.000 fichas) en unas 3 horas.
//   Una persona que busca de verdad no se acerca: 24 fichas por página, 20 páginas como
//   máximo por búsqueda.
//
// IDENTIDAD SIN IP: el cliente se identifica con un HMAC de la IP, con clave secreta del
// servidor y la FECHA (rota cada día). Ni Upstash ni los logs ven la IP: un hash sin clave
// de una IPv4 se revierte probando las ~4 mil millones posibles; uno con clave secreta no.
// La rotación diaria impide enlazar a un mismo cliente entre días.
//
// SI FALLA EL SERVICIO DE CONTADORES (Upstash caído o sin configurar): no se abre del todo
// ni se bloquea a todos. Se usa un contador en memoria de la instancia, con los mismos
// topes. Es más laxo (cada instancia cuenta por su lado), pero sigue frenando a un
// scraper insistente, y se registra `mls_rate_limit_degraded` para el monitoreo.
//
// LA IP: se toma de `x-forwarded-for` (primer salto). En Vercel esa cabecera la REESCRIBE la
// plataforma para impedir que el cliente la falsifique (docs de Vercel, request headers).
import { createHmac, randomBytes } from "node:crypto";
import { apiLimiter } from "@/lib/ratelimit";

export const MLS_VIEWS_PER_5_MIN = 60;
export const MLS_VIEWS_PER_DAY = 300;

const FIVE_MIN_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** Tope de clientes que recuerda el contador de respaldo por instancia. */
const MEMORY_MAX_CLIENTS = 5_000;

// Clave de respaldo si no hay secreto del servidor (desarrollo local): aleatoria por proceso.
const FALLBACK_KEY = randomBytes(32);

/** HMAC de la IP con clave secreta del servidor y la fecha UTC. Nunca contiene la IP. */
export function clientTag(
  ip: string,
  now: Date = new Date(),
  secret: string | undefined = process.env.SUPABASE_SECRET_KEY,
): string {
  const day = now.toISOString().slice(0, 10);
  return createHmac("sha256", secret || FALLBACK_KEY)
    .update(`mls-scrape|${day}|${ip}`)
    .digest("hex")
    .slice(0, 16);
}

/** IP del cliente según la plataforma. Sin cabecera (no ocurre en Vercel): "unknown". */
export function clientIp(get: (name: string) => string | null): string {
  return get("x-forwarded-for")?.split(",")[0]?.trim() || get("x-real-ip")?.trim() || "unknown";
}

interface Limiter {
  limit(id: string): Promise<{ success: boolean }>;
}

export interface GuardDeps {
  short: Limiter | null;
  daily: Limiter | null;
  now: () => number;
}

export type GuardResult =
  | { outcome: "ok"; degraded: boolean; tag: string }
  | { outcome: "limited"; degraded: boolean; tag: string; window: "5m" | "24h" };

// ── Contador de respaldo en memoria (por instancia) ────────────────────────────────
const memory = new Map<string, number[]>();

/** Registra una vista y dice si supera algún tope. Exportada para las pruebas. */
export function memoryCheck(tag: string, now: number): "ok" | "5m" | "24h" {
  const hits = (memory.get(tag) ?? []).filter((t) => now - t < DAY_MS);
  hits.push(now);
  memory.delete(tag);
  memory.set(tag, hits); // reinsertar = más reciente al final
  if (memory.size > MEMORY_MAX_CLIENTS) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  if (hits.filter((t) => now - t < FIVE_MIN_MS).length > MLS_VIEWS_PER_5_MIN) return "5m";
  if (hits.length > MLS_VIEWS_PER_DAY) return "24h";
  return "ok";
}

export function resetMemoryForTests(): void {
  memory.clear();
}

function defaultDeps(): GuardDeps {
  return {
    short: apiLimiter("mls-public-5m", MLS_VIEWS_PER_5_MIN, "5 m"),
    daily: apiLimiter("mls-public-24h", MLS_VIEWS_PER_DAY, "24 h"),
    now: () => Date.now(),
  };
}

let lastDegradedLog = 0;
function logDegraded(reason: string, now: number): void {
  if (now - lastDegradedLog < 60_000) return; // como mucho, una línea por minuto por instancia
  lastDegradedLog = now;
  console.error(JSON.stringify({ event: "mls_rate_limit_degraded", reason }));
}

/** Cuenta una vista de fichas del feed para esta IP y decide si se sirve. */
export async function checkMlsView(ip: string, deps: GuardDeps = defaultDeps()): Promise<GuardResult> {
  const now = deps.now();
  const tag = clientTag(ip, new Date(now));

  const fromMemory = (reason: string): GuardResult => {
    logDegraded(reason, now);
    const r = memoryCheck(tag, now);
    return r === "ok" ? { outcome: "ok", degraded: true, tag } : { outcome: "limited", degraded: true, tag, window: r };
  };

  if (!deps.short || !deps.daily) return fromMemory("limiter_not_configured");
  try {
    const [short, daily] = await Promise.all([deps.short.limit(tag), deps.daily.limit(tag)]);
    if (typeof short?.success !== "boolean" || typeof daily?.success !== "boolean") {
      return fromMemory("malformed_limiter_response");
    }
    if (!short.success) return { outcome: "limited", degraded: false, tag, window: "5m" };
    if (!daily.success) return { outcome: "limited", degraded: false, tag, window: "24h" };
    return { outcome: "ok", degraded: false, tag };
  } catch {
    return fromMemory("limiter_unreachable");
  }
}
