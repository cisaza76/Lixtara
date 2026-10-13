// Código HTTP de la ficha pública /[lang]/property/[id] (issue #135).
//
//   no existe, id inválido, o is_test      → 404  (is_test: no revelar que el registro existe)
//   activo                                  → 200
//   retirado / vencido / cerrado            → 410 Gone (sale antes del índice)
//   draft / pending_approval / under_contract → 404 (nunca fue público, o puede volver)
//
// Ambos errores llevan noindex y nada de datos del listing en el HTML.
// El 410 lo emite el proxy (App Router no tiene `gone()`); el 404 lo emite la página con
// notFound(). Aplica también a futuras fichas del feed IDX: una ficha retirada del feed
// debe responder 410 (Schedule A: retirar expirados en 24 h).

export type ListingHttpStatus = 200 | 404 | 410;

export interface ListingVisibilityRow {
  mls_status: string | null;
  is_test: boolean | null;
}

const GONE_STATUSES = new Set(["withdrawn", "expired", "closed"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function listingHttpStatus(row: ListingVisibilityRow | null): ListingHttpStatus {
  if (!row) return 404;
  if (row.is_test) return 404;
  if (row.mls_status === "active") return 200;
  if (row.mls_status && GONE_STATUSES.has(row.mls_status)) return 410;
  return 404;
}

/** Ruta de detalle de un listing propio: /en/property/<id> (sin subrutas). */
const DETAIL_RE = /^\/(en|es)\/property\/([^/]+)\/?$/;

export function matchListingDetailPath(
  pathname: string,
): { lang: "en" | "es"; id: string } | null {
  const m = DETAIL_RE.exec(pathname);
  if (!m) return null;
  return { lang: m[1] as "en" | "es", id: m[2] };
}

/**
 * Lee mls_status + is_test con la clave de servidor (la lectura pública solo ve activos y
 * no distingue "retirado" de "no existe"). Devuelve:
 *   - la fila o null si no existe,
 *   - undefined si no se pudo consultar (sin env, red, timeout) → quien llama deja pasar
 *     la petición a la página, que responde 200 o 404 por su cuenta.
 */
export async function fetchListingVisibility(
  id: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ListingVisibilityRow | null | undefined> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !isUuid(id)) return undefined;
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(
      `${url}/rest/v1/properties?id=eq.${id}&select=mls_status,is_test&limit=1`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 1500),
      },
    );
    if (!res.ok) return undefined;
    const rows = (await res.json()) as ListingVisibilityRow[];
    return rows[0] ?? null;
  } catch {
    return undefined;
  }
}

/** Página mínima del 404/410: sin datos del listing, noindex, enlace al catálogo. */
export function listingErrorHtml(lang: "en" | "es", status: 404 | 410): string {
  const es = lang === "es";
  const c = status === 410
    ? es
      ? { title: "Este listing ya no está disponible", body: "La propiedad fue retirada del mercado." }
      : { title: "This listing is no longer available", body: "The property has been taken off the market." }
    : es
      ? { title: "Listing no encontrado", body: "Esta propiedad no está publicada." }
      : { title: "Listing not found", body: "This property is not listed." };
  const back = es ? "Ver propiedades disponibles" : "See available properties";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${c.title} — Lixtara</title></head><body style="margin:0;font-family:Georgia,serif;background:#f4f1ec;color:#1c1c1c;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px"><main><h1 style="font-weight:400;font-size:32px">${c.title}</h1><p style="font-family:Arial,sans-serif;color:#555">${c.body}</p><p><a href="/${lang}/properties" style="color:#a18943;font-family:Arial,sans-serif;font-size:12px;letter-spacing:.2em;text-transform:uppercase">${back}</a></p></main></body></html>`;
}

/**
 * Decide en el proxy si la ficha responde 404/410 sin llegar a la página. La página tiene
 * loading.tsx (streaming): si llamara notFound() tras empezar a transmitir, el status ya
 * sería 200. Por eso el código HTTP se fija aquí. Devuelve null para dejar pasar.
 */
export async function listingDetailErrorStatus(
  id: string,
  lookup: (id: string) => Promise<ListingVisibilityRow | null | undefined> = fetchListingVisibility,
): Promise<404 | 410 | null> {
  if (!isUuid(id)) return 404;
  const row = await lookup(id);
  if (row === undefined) return null; // no se pudo consultar: decide la página
  const status = listingHttpStatus(row);
  return status === 200 ? null : status;
}
