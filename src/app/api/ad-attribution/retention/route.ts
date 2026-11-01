// GET|POST /api/ad-attribution/retention — Vercel Cron, una vez al día (vercel.json).
//
// Borra la IP y el user agent de ad_attribution guardados hace más de 90 días
// (AD_IP_UA_RETENTION_DAYS). El otro borrado, al confirmarse el pago del plan, lo hace
// metaPlanPurchase. Sin la migración aplicada no hace nada.

import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/mls/cron-secret";
import { purgeExpiredIpAndUa } from "@/lib/meta-capi.server";

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  if (!verifyCronSecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const cleared = await purgeExpiredIpAndUa();
    console.log(JSON.stringify({ event: "ad_attribution_retention_run", cleared }));
    return NextResponse.json({ cleared });
  } catch (e) {
    console.error(JSON.stringify({ event: "ad_attribution_retention_error", error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
