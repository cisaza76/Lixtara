// TEMPORAL — P1 post-merge observability smoke (pre-Gate-5). Authenticated with the worker's
// CRON_SECRET (timing-safe), 404 otherwise. Throws an UNCAUGHT error so `onRequestError`
// captures it from the REAL deployed runtime. Every seeded "sensitive-looking" value is built
// AT RUNTIME (never a literal in this file) so stack-frame source context cannot echo it.
// This file is removed immediately after the smoke run.
import { timingSafeEqual } from "node:crypto";

export const maxDuration = 15;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

const syn = (prefix: string): string => `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return Response.json({ error: "not_found" }, { status: 404 });
  const marker = req.headers.get("x-smoke-marker") ?? syn("obs-smoke");
  const Sentry = await import("@sentry/nextjs");
  const jwtSyn = ["eyJ" + syn("hdr").replace(/-/g, ""), syn("payload").replace(/-/g, "") + "x".repeat(8), syn("sig").replace(/-/g, "") + "y".repeat(8)].join(".");
  Sentry.addBreadcrumb({
    category: "fetch",
    message: `GET https://fake.supabase.co/storage/sign/x.mp4?token=${syn("bctok")}`,
    data: { url: `https://fake.host/verify?token=${syn("urltok")}`, body: syn("bcbody") },
  });
  Sentry.setContext("smokeSeeds", {
    syntheticJwt: jwtSyn,
    syntheticSignedUrl: `https://fake.supabase.co/object/sign/f.mp4?token=${syn("extratok")}`,
    syntheticEmail: `${syn("user")}@example.com`,
  });
  throw new Error(`${marker}: synthetic failure Bearer ${syn("errtok")} at https://fake.api/x?token=${syn("qstok")}`);
}
