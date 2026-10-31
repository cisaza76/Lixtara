// El aviso de cookies avisa aquí cada vez que cambia la elección, para que la API de
// Conversiones de Meta use la elección vigente también en los hitos que llegan sin
// navegador (firma por el webhook de DocuSign, pago por el de Stripe).
//   - Elección guardada: se leen la cookie y Global Privacy Control de ESTA petición.
//   - { reset: true } ("Configurar cookies" borra la elección): cuenta como Publicidad
//     denegada hasta que vuelva a elegir.
// Sin sesión no hay nada que guardar. Siempre responde 204: no revela nada.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gpcEnabled } from "@/lib/analytics-config";
import { adIdentifiersFromRequest } from "@/lib/meta-capi";
import { saveAdAttribution } from "@/lib/meta-capi.server";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";

export async function POST(req: Request) {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (!user) return new NextResponse(null, { status: 204 });
  const limited = await enforceLimit(apiLimiter("ad-attribution", 30, "1 h"), user.id, {
    message: "Too many requests",
    label: "ad-attribution",
  });
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { reset?: unknown } | null;
  const ids =
    body?.reset === true
      ? ({ ads: "denied" } as const)
      : adIdentifiersFromRequest({
          cookieHeader: req.headers.get("cookie"),
          xForwardedFor: req.headers.get("x-forwarded-for"),
          userAgent: req.headers.get("user-agent"),
          gpc: gpcEnabled(req.headers.get("sec-gpc")),
        });
  await saveAdAttribution(user.id, ids);
  return new NextResponse(null, { status: 204 });
}
