import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { defaultLocale, isLocale } from "@/lib/i18n";
import { resolveSlugAlias } from "@/lib/routing/slug-aliases";
import {
  listingDetailErrorStatus,
  listingErrorHtml,
  matchListingDetailPath,
} from "@/lib/routing/listing-http-status";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const firstSegment = pathname.split("/")[1];

  // Slugs en español (/servicios, /es/propiedades, …) → ruta canónica. 308: permanente,
  // conserva el método. Va ANTES del prefijo de idioma por defecto (#114).
  const alias = resolveSlugAlias(pathname);
  if (alias) {
    const url = request.nextUrl.clone();
    url.pathname = alias.pathname;
    if (alias.hash) url.hash = alias.hash;
    return NextResponse.redirect(url, 308);
  }

  if (!isLocale(firstSegment)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${defaultLocale}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url);
  }

  // Ficha pública de un listing: 410 Gone si fue retirado / vencido / cerrado; 404 si no
  // existe, es is_test o nunca se publicó. Ambos con noindex y sin datos (#135). Se decide
  // aquí porque la página transmite en streaming (loading.tsx) y ahí el status ya sería
  // 200. Si la consulta falla, la petición sigue a la página: nunca un 5xx por esto.
  const detail = matchListingDetailPath(pathname);
  if (detail && (request.method === "GET" || request.method === "HEAD")) {
    const status = await listingDetailErrorStatus(detail.id);
    if (status) {
      return new NextResponse(
        request.method === "HEAD" ? null : listingErrorHtml(detail.lang, status),
        {
          status,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "x-robots-tag": "noindex",
            "cache-control": "public, max-age=300",
          },
        },
      );
    }
  }

  const { response } = await updateSession(request);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
