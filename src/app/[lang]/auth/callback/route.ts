import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Fall through to sign-in with error if no code or exchange failed.
  // The lang segment is part of the request URL path — preserve it.
  const langMatch = request.nextUrl.pathname.match(/^\/(en|es)\//);
  const lang = langMatch?.[1] ?? "en";
  return NextResponse.redirect(`${origin}/${lang}/sign-in?error=unexpected`);
}
