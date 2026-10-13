// Segment = the filters used to pick owners, both in the admin list
// (/admin/crm/owners) and when a campaign is sent. Stored as-is in
// crm_campaigns.segment so the send reproduces exactly what was saved.
//
// Values mirror the CHECK constraints of 20261012120000_crm_leads.sql.
// There is deliberately no filter on property signals or MLS status: the
// 'mls_expirado' signal must not be shown or filtered in the UI until the MLS
// confirms which source may be used for prospecting.

export const PRIORITIES = ["A", "B", "C"] as const;
export const OWNER_TYPES = [
  "Persona Natural", "Trust", "Sucesión", "LLC", "Corporación", "Sociedad", "Entidad (sin sufijo)",
] as const;
export const PILOT_GROUPS = ["Score", "Control"] as const;
export const OUTREACH_STATUSES = [
  "Sin contactar", "Contactado", "Respondió", "Interesado", "No interesado", "Baja", "Rebote",
  "Persona equivocada",
] as const;
export const HAS_EMAIL = ["yes", "no"] as const;

export interface Segment {
  priority?: (typeof PRIORITIES)[number];
  ownerType?: (typeof OWNER_TYPES)[number];
  zip?: string;
  pilotGroup?: (typeof PILOT_GROUPS)[number];
  status?: (typeof OUTREACH_STATUSES)[number];
  hasEmail?: (typeof HAS_EMAIL)[number];
}

type Source = Record<string, unknown> | URLSearchParams | FormData;

function read(src: Source, key: string): string {
  const v = src instanceof URLSearchParams || src instanceof FormData ? src.get(key) : src[key];
  return typeof v === "string" ? v.trim() : "";
}

function pick<T extends readonly string[]>(list: T, value: string): T[number] | undefined {
  return (list as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

/** Parses untrusted input (search params, form data, stored jsonb). Unknown values are dropped. */
export function parseSegment(src: Source | null | undefined): Segment {
  if (!src) return {};
  const seg: Segment = {
    priority: pick(PRIORITIES, read(src, "priority")),
    ownerType: pick(OWNER_TYPES, read(src, "ownerType")),
    zip: /^\d{5}$/.test(read(src, "zip")) ? read(src, "zip") : undefined,
    pilotGroup: pick(PILOT_GROUPS, read(src, "pilotGroup")),
    status: pick(OUTREACH_STATUSES, read(src, "status")),
    hasEmail: pick(HAS_EMAIL, read(src, "hasEmail")),
  };
  return Object.fromEntries(Object.entries(seg).filter(([, v]) => v !== undefined)) as Segment;
}

export function segmentToSearchParams(seg: Segment): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(seg)) if (v) sp.set(k, v);
  return sp;
}

/**
 * PostgREST select for owners (table or crm_sendable_email_owners). A ZIP filter
 * needs an inner embed through the current property ownerships; without one the
 * select stays flat.
 */
export function segmentSelect(columns: string, seg: Segment): string {
  return seg.zip
    ? `${columns},crm_property_owners!inner(valid_to,crm_properties!inner(zip))`
    : columns;
}

// The subset of the PostgREST filter builder this module uses. Kept non-generic:
// the real builder's generics make TypeScript recurse forever (TS2589).
interface Filterable {
  eq(column: string, value: string): Filterable;
  is(column: string, value: null): Filterable;
  not(column: string, operator: string, value: null): Filterable;
}

/** Applies the segment's filters to an owners query built with segmentSelect(). */
export function applySegment<T>(query: T, seg: Segment): T {
  let q = query as unknown as Filterable;
  if (seg.priority) q = q.eq("priority", seg.priority);
  if (seg.ownerType) q = q.eq("owner_type", seg.ownerType);
  if (seg.pilotGroup) q = q.eq("pilot_group", seg.pilotGroup);
  if (seg.status) q = q.eq("outreach_status", seg.status);
  if (seg.hasEmail === "yes") q = q.not("email", "is", null);
  if (seg.hasEmail === "no") q = q.is("email", null);
  if (seg.zip) {
    q = q.eq("crm_property_owners.crm_properties.zip", seg.zip);
    q = q.is("crm_property_owners.valid_to", null);
  }
  return q as unknown as T;
}
