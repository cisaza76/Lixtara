// GET/POST /api/mls/sync — worker de sincronización del feed IDX, disparado por Vercel Cron.
//
// Mismo molde que el worker de video (/api/creative-studio/video/worker), que lleva meses
// en producción: secreto de cron verificado en tiempo constante, presupuesto de reloj, y
// una respuesta pequeña sin trazas ni secretos.
//
// DOS PUERTAS, en este orden:
//   1. CRON_SECRET — si no coincide, 401 genérico sin decir por qué.
//   2. assertMlsIngestAllowed() — producción + MLS_FEED_ENABLED. Fuera de ahí, 404: el
//      acuerdo licencia el feed para un solo sitio y un preview no es ese sitio.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { mlsIngestDecision, readMlsGateEnv } from "@/lib/mls/environment-gate";
import { createBridgeProvider } from "@/lib/mls/bridge-adapter";
import { createSupabaseSyncStore } from "@/lib/mls/sync-store.supabase";
import { runMlsSync, syncNeedsAttention } from "@/lib/mls/sync-run";

export const dynamic = "force-dynamic";

/**
 * Comparación en tiempo constante del VALOR. El pre-chequeo de longitud es la desviación
 * estándar del patrón (timingSafeEqual de Node lanza con buffers de distinto tamaño): solo
 * filtra si las longitudes difieren, nunca qué caracteres coinciden. Todo fallo devuelve el
 * mismo 401 — nunca se revela si faltaba la cabecera, si el valor era otro, o si la
 * variable no está configurada.
 */
function verifyCronSecret(req: Request): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false; // fail-closed: nunca "abierto" por omisión

  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;

  const a = Buffer.from(presented);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function intEnv(name: string, def: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

async function handle(req: Request): Promise<Response> {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // El gate decide con el mismo criterio que el resto del subsistema. 404 y no 403: fuera
  // de producción esta ruta no debe siquiera admitir que existe.
  const decision = mlsIngestDecision(readMlsGateEnv());
  if (!decision.allowed) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const dataset = process.env.MLS_BRIDGE_DATASET;
  if (!dataset) {
    return NextResponse.json({ error: "dataset_not_configured" }, { status: 500 });
  }

  const resumen = await runMlsSync({
    provider: createBridgeProvider({ dataset }),
    store: createSupabaseSyncStore(),
    now: () => Date.now(),
    timeBudgetMs: intEnv("MLS_SYNC_BUDGET_MS", 50_000),
    maxPages: intEnv("MLS_SYNC_MAX_PAGES", 200),
  });

  const atencion = syncNeedsAttention(resumen);
  // Log estructurado, mismo patrón que video-engine/observability-log.ts. Nunca lleva una
  // ficha: solo conteos y motivos.
  console.log(JSON.stringify({
    event: "mls_sync_run",
    dataset: resumen.dataset,
    completed: resumen.completed,
    stoppedBy: resumen.stoppedBy,
    pages: resumen.pages,
    received: resumen.received,
    upserted: resumen.upserted,
    excluded: resumen.excluded,
    malformed: resumen.malformed,
    error: resumen.error,
    needsAttention: atencion.attention,
    attentionReason: atencion.reason ?? null,
  }));

  // El cuerpo no lleva el mensaje de error crudo: puede arrastrar detalle del proveedor.
  return NextResponse.json({
    completed: resumen.completed,
    stoppedBy: resumen.stoppedBy,
    pages: resumen.pages,
    received: resumen.received,
    upserted: resumen.upserted,
    needsAttention: atencion.attention,
  });
}

export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }
