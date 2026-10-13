import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/safe-redirect";

// Token-hash sign-in (magic links we send ourselves, e.g. "continue your
// listing"). Unlike /auth/callback (PKCE code exchange), this works when the
// link is opened on a different device or browser than the one that asked.
const ALLOWED_TYPES: EmailOtpType[] = ["email", "magiclink"];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"), origin, "/");
  const langMatch = request.nextUrl.pathname.match(/^\/(en|es)\//);
  const lang = langMatch?.[1] ?? "en";

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  // Expired or already used: offer a fresh link instead of a dead end.
  return NextResponse.redirect(`${origin}/${lang}/listing/continue?error=link`);
}
