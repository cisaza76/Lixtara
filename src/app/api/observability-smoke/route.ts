// TEMPORAL — P1 smoke v2 (diagnóstico + captura directa). Autenticado; se elimina tras el smoke.
// Valores "sensibles" sintéticos SIEMPRE construidos en runtime (nunca literales).
import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";

export const maxDuration = 15;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(got); const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

const syn = (p: string): string => `${p}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return Response.json({ error: "not_found" }, { status: 404 });
  const marker = req.headers.get("x-smoke-marker") ?? syn("obs-smoke");
  const hasClient = !!Sentry.getClient();
  const dsnSeen = !!(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN);
  Sentry.addBreadcrumb({
    category: "fetch",
    message: `GET https://fake.supabase.co/storage/sign/x.mp4?token=${syn("bctok")}`,
    data: { url: `https://fake.host/verify?token=${syn("urltok")}`, body: syn("bcbody") },
  });
  Sentry.captureException(
    new Error(`${marker}: synthetic failure Bearer ${syn("errtok")} at https://fake.api/x?token=${syn("qstok")}`),
    {
      extra: {
        syntheticJwt: ["eyJ" + syn("h").replace(/-/g,"") + "aaaaaaaa", syn("p").replace(/-/g,"") + "bbbbbbbb", syn("s").replace(/-/g,"") + "cccccccc"].join("."),
        syntheticSignedUrl: `https://fake.supabase.co/object/sign/f.mp4?token=${syn("extratok")}`,
        syntheticEmail: `${syn("user")}@example.com`,
      },
      tags: { smoke: "p1-prod", route: "/api/observability-smoke" },
    },
  );
  const flushed = await Sentry.flush(6000);
  return Response.json({ marker, hasClient, dsnSeen, flushed });
}
