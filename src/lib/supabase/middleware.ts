import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// `forwardHeaders` are added to the request the app renders with (not to the response).
export async function updateSession(
  request: NextRequest,
  forwardHeaders: Record<string, string> = {},
) {
  const headers = new Headers(request.headers);
  for (const [k, v] of Object.entries(forwardHeaders)) headers.set(k, v);
  let supabaseResponse = NextResponse.next({ request: { headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          // Cookies written above live on request.cookies; mirror them into the
          // forwarded headers so the render sees the refreshed session.
          headers.set("cookie", request.cookies.toString());
          supabaseResponse = NextResponse.next({ request: { headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();

  return { supabase, response: supabaseResponse };
}
