// GET/POST /api/mls/sync — worker de sincronización del feed IDX, disparado por Vercel Cron.
//
// Mismo molde que el worker de video (/api/creative-studio/video/worker), que lleva meses
// en producción: secreto de cron verificado en tiempo constante, presupuesto de reloj, y
// una respuesta pequeña sin trazas ni secretos.
//
// DOS PUERTAS, en este orden:
//   1. CRON_SECRET — si no coincide, 401 genérico sin decir por qué.
//   2. mlsIngestDecision() — producción + MLS_SYNC_ENABLED (o el flag viejo MLS_FEED_ENABLED
//      si el nuevo no está definido). Fuera de ahí, 404: el
//      acuerdo licencia el feed para un solo sitio y un preview no es ese sitio.
import { NextResponse } from "next/server";
import { mlsIngestDecision, readMlsGateEnv } from "@/lib/mls/environment-gate";
import { createBridgeProvider } from "@/lib/mls/bridge-adapter";
import { createSupabaseSyncStore } from "@/lib/mls/sync-store.supabase";
import { runMlsSync, syncNeedsAttention } from "@/lib/mls/sync-run";
import { intEnv, verifyCronSecret } from "@/lib/mls/cron-secret";

export const dynamic = "force-dynamic";

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
    phase: resumen.phase,
    removalKeysReceived: resumen.removalKeysReceived,
    removed: resumen.removed,
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
    removed: resumen.removed,
    needsAttention: atencion.attention,
  });
}

export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }
