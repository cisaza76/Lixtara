// GET|POST /api/agreement/deadlines — Vercel Cron, cada hora (vercel.json).
//
// Plazo de firma con dos vendedores (#220, owner 2026-10-21): recordatorios de Lixtara al segundo
// firmante a los días 2 y 5; al día 7 sin todas las firmas, el sobre se anula, el acuerdo queda
// "expired" y se avisa a los dos. La lógica: src/lib/signing-deadlines.server.ts.

import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/mls/cron-secret";
import { runSigningDeadlines } from "@/lib/signing-deadlines.server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(req: Request) {
  if (!verifyCronSecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await runSigningDeadlines();
    console.log(JSON.stringify({ event: "signing_deadlines_run", ...result }));
    return NextResponse.json(result);
  } catch (e) {
    console.error(JSON.stringify({ event: "signing_deadlines_error", error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
