// GET/POST /api/mls/reconcile — reconciliación diaria del feed IDX, disparada por Vercel Cron.
//
// Detecta fichas ELIMINADAS del feed, que ningún incremental ve. Ver reconcile-run.ts.
//
// El cron corre varias veces en una ventana nocturna; cada invocación es barata cuando no
// toca (`not_due`) y, cuando toca, continúa donde quedó la anterior hasta cerrar la lista.
//
// MISMAS DOS PUERTAS que /api/mls/sync, en el mismo orden: CRON_SECRET (401 genérico) y
// luego la puerta de INGESTA (MLS_SYNC_ENABLED + producción; 404 fuera de ahí). Es
// ingesta: llama a Bridge y escribe en mls_listings.
import { NextResponse } from "next/server";
import { mlsIngestDecision, readMlsGateEnv } from "@/lib/mls/environment-gate";
import { createBridgeProvider } from "@/lib/mls/bridge-adapter";
import { createSupabaseReconcileStore } from "@/lib/mls/reconcile-store.supabase";
import { reconcileNeedsAttention, runMlsReconciliation } from "@/lib/mls/reconcile-run";
import { intEnv, verifyCronSecret } from "@/lib/mls/cron-secret";

export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!mlsIngestDecision(readMlsGateEnv()).allowed) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const dataset = process.env.MLS_BRIDGE_DATASET;
  if (!dataset) {
    return NextResponse.json({ error: "dataset_not_configured" }, { status: 500 });
  }

  const r = await runMlsReconciliation({
    provider: createBridgeProvider({ dataset }),
    store: createSupabaseReconcileStore(),
    now: () => Date.now(),
    timeBudgetMs: intEnv("MLS_RECONCILE_BUDGET_MS", 50_000),
    maxPages: intEnv("MLS_RECONCILE_MAX_PAGES", 100),
  });

  const atencion = reconcileNeedsAttention(r);
  // Log estructurado. Nunca lleva una clave ni una ficha: solo conteos y motivos.
  console.log(JSON.stringify({
    event: "mls_reconcile_run",
    dataset: r.dataset,
    outcome: r.outcome,
    started: r.started,
    restartedStale: r.restartedStale,
    stoppedBy: r.stoppedBy,
    pages: r.pages,
    keysReceived: r.keysReceived,
    keysSeen: r.keysSeen,
    stored: r.stored,
    deleted: r.deleted,
    error: r.error,
    needsAttention: atencion.attention,
    attentionReason: atencion.reason ?? null,
  }));

  return NextResponse.json({
    outcome: r.outcome,
    stoppedBy: r.stoppedBy,
    pages: r.pages,
    keysSeen: r.keysSeen,
    stored: r.stored,
    deleted: r.deleted,
    needsAttention: atencion.attention,
  });
}

export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }
