import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const { origin } = new URL(request.url);
  const langMatch = request.nextUrl.pathname.match(/^\/(en|es)\//);
  const lang = langMatch?.[1] ?? "en";
  return NextResponse.redirect(`${origin}/${lang}`, { status: 303 });
}
