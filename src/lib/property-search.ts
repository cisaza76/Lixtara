// Filtros y paginación de /properties.
//
// Todo llega por la URL (?min_price=…&beds=…&page=…), así que cada valor se valida contra
// una lista cerrada: lo que no está en la lista se descarta en silencio y la página sigue
// funcionando. Nada de lo que teclee un visitante llega crudo a la consulta.
//
// TOPE DE PÁGINAS: el Schedule A del acuerdo con MIAMI obliga a impedir activamente que
// el feed se descargue entero (§1 anti-scraping, §6). Con ~50.000 fichas, una paginación
// sin fin es justo eso. Se muestran como máximo MAX_PAGE páginas; para ver más, el
// visitante tiene que acotar la búsqueda.
//
// PURO: sin I/O.

export const PAGE_SIZE = 24;
export const MAX_PAGE = 20;

/** Escalones de precio de los selectores (USD). */
export const PRICE_STEPS = [
  100_000, 200_000, 300_000, 400_000, 500_000, 750_000,
  1_000_000, 1_500_000, 2_000_000, 3_000_000, 5_000_000, 10_000_000,
] as const;
export const BED_OPTIONS = [1, 2, 3, 4, 5] as const;
export const BATH_OPTIONS = [1, 2, 3, 4] as const;

/** Clave = `mls_listings.county_key` (migración 20261011120000). */
export const COUNTY_OPTIONS = [
  { key: "miamidade", label: "Miami-Dade" },
  { key: "broward", label: "Broward" },
  { key: "palmbeach", label: "Palm Beach" },
] as const;
export type CountyKey = (typeof COUNTY_OPTIONS)[number]["key"];

export const SORT_OPTIONS = ["newest", "price_asc", "price_desc"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export interface PropertySearch {
  minPrice: number | null;
  maxPrice: number | null;
  beds: number | null;
  baths: number | null;
  county: CountyKey | null;
  zip: string | null;
  sort: SortOption;
  page: number;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function fromList<T extends number>(raw: string | undefined, list: readonly T[]): T | null {
  const n = Number(raw);
  return list.includes(n as T) ? (n as T) : null;
}

export function parsePropertySearch(sp: RawSearchParams): PropertySearch {
  let minPrice = fromList(first(sp.min_price), PRICE_STEPS);
  let maxPrice = fromList(first(sp.max_price), PRICE_STEPS);
  // Rango invertido: se intercambian en vez de devolver cero resultados.
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }

  const countyRaw = first(sp.county);
  const county = COUNTY_OPTIONS.find((c) => c.key === countyRaw)?.key ?? null;

  const zipRaw = first(sp.zip)?.trim();
  const zip = zipRaw && /^\d{5}$/.test(zipRaw) ? zipRaw : null;

  const sortRaw = first(sp.sort);
  const sort = (SORT_OPTIONS as readonly string[]).includes(sortRaw ?? "")
    ? (sortRaw as SortOption)
    : "newest";

  const pageRaw = Number.parseInt(first(sp.page) ?? "", 10);
  const page = Number.isFinite(pageRaw) ? Math.min(Math.max(pageRaw, 1), MAX_PAGE) : 1;

  return {
    minPrice,
    maxPrice,
    beds: fromList(first(sp.beds), BED_OPTIONS),
    baths: fromList(first(sp.baths), BATH_OPTIONS),
    county,
    zip,
    sort,
    page,
  };
}

/** True si el visitante aplicó algún filtro (no cuenta el orden ni la página). */
export function hasActiveFilters(s: PropertySearch): boolean {
  return (
    s.minPrice !== null || s.maxPrice !== null || s.beds !== null || s.baths !== null ||
    s.county !== null || s.zip !== null
  );
}

/** Query string canónica (sin valores por defecto) para enlaces de paginación. */
export function propertySearchQuery(s: PropertySearch, overrides: Partial<PropertySearch> = {}): string {
  const v = { ...s, ...overrides };
  const q = new URLSearchParams();
  if (v.minPrice !== null) q.set("min_price", String(v.minPrice));
  if (v.maxPrice !== null) q.set("max_price", String(v.maxPrice));
  if (v.beds !== null) q.set("beds", String(v.beds));
  if (v.baths !== null) q.set("baths", String(v.baths));
  if (v.county !== null) q.set("county", v.county);
  if (v.zip !== null) q.set("zip", v.zip);
  if (v.sort !== "newest") q.set("sort", v.sort);
  if (v.page > 1) q.set("page", String(v.page));
  const str = q.toString();
  return str ? `?${str}` : "";
}

/** Páginas navegables para `total` resultados, con el tope anti-scraping. */
export function pageCount(total: number): number {
  return Math.min(Math.max(Math.ceil(total / PAGE_SIZE), 1), MAX_PAGE);
}

/** True si hay más resultados de los que el tope deja recorrer. */
export function isTruncated(total: number): boolean {
  return total > PAGE_SIZE * MAX_PAGE;
}

/** Lo que el filtro necesita de un listing propio (`properties`). */
export interface OwnListingFilterable {
  list_price: number;
  bedrooms: number | null;
  bathrooms: number | null;
  address_zip: string;
}

/**
 * Filtro de los listings PROPIOS, en memoria (son pocos). `properties` no guarda el condado,
 * así que con un filtro de condado activo se ocultan: mostrar una casa de Miami-Dade en una
 * búsqueda de Broward sería peor que no mostrarla.
 */
export function ownListingMatches(p: OwnListingFilterable, s: PropertySearch): boolean {
  if (s.county !== null) return false;
  if (s.minPrice !== null && p.list_price < s.minPrice) return false;
  if (s.maxPrice !== null && p.list_price > s.maxPrice) return false;
  if (s.beds !== null && (p.bedrooms ?? 0) < s.beds) return false;
  if (s.baths !== null && (p.bathrooms ?? 0) < s.baths) return false;
  if (s.zip !== null && p.address_zip?.slice(0, 5) !== s.zip) return false;
  return true;
}
