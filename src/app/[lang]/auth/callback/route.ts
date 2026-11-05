import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { metaLeadOnFirstEmailVerification } from "@/lib/meta-capi.server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` is user-controlled — resolve it to a SAME-ORIGIN relative path only (never string
  // concatenation), so a crafted callback link cannot bounce a freshly-authenticated user to
  // an external host. See src/lib/auth/safe-redirect.ts.
  const next = safeNextPath(searchParams.get("next"), origin, "/");
  const lang = request.nextUrl.pathname.match(/^\/(en|es)\//)?.[1] ?? "en";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Meta (Lead): solo si este enlace confirmó el correo por primera vez.
      await metaLeadOnFirstEmailVerification({ user: data.user, lang });
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Fall through to sign-in with error if no code or exchange failed.
  // The lang segment is part of the request URL path — preserve it.
  return NextResponse.redirect(`${origin}/${lang}/sign-in?error=unexpected`);
}
