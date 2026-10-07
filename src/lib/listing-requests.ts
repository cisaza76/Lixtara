// Solicitudes del vendedor sobre un listing ya enviado (#134 retiro, #136 cambios).
//
// Desde que el listing deja de ser borrador, el vendedor ya no escribe sus campos clave
// en `properties` (guard_properties_seller_columns, migración 20261007170000). Pide el
// cambio; la broker lo pasa a Matrix, lo aprueba en /admin y solo entonces se aplica.
// Este módulo es lógica pura (sin red ni base): qué se puede pedir, en qué estado, y la
// validación de cada valor. La escritura vive en listing-requests.server.ts.

export type ListingRequestKind = "change" | "withdrawal";
export type ListingRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

/** Estados en los que el vendedor puede pedir un cambio de campos. */
export const CHANGE_REQUESTABLE_STATUSES = ["pending_approval", "active", "under_contract"] as const;

/**
 * Estados en los que el vendedor puede pedir el retiro. under_contract queda fuera: con una
 * oferta aceptada el retiro depende del contrato de 24 meses y del contrato de compraventa,
 * así que lo gestiona la broker directamente (el vendedor la contacta).
 */
export const WITHDRAWAL_REQUESTABLE_STATUSES = ["pending_approval", "active"] as const;

export const PROPERTY_TYPES = ["single_family", "condo", "townhouse", "multi_family"] as const;
export const OCCUPANCY_STATUSES = ["vacant", "owner_occupied", "tenant_occupied"] as const;

type FieldSpec =
  | { kind: "int"; min: number; max: number; nullable?: boolean }
  | { kind: "number"; min: number; max: number; step?: number; nullable?: boolean }
  | { kind: "text"; max: number; nullable?: boolean; pattern?: RegExp }
  | { kind: "enum"; values: readonly string[]; nullable?: boolean }
  | { kind: "bool" };

const thisYear = () => new Date().getFullYear();

/**
 * Campos clave que el vendedor puede pedir cambiar, con las MISMAS reglas que el asistente
 * /listing/new. Todos se publican en lixtara.com y/o van al MLS. Quedan fuera los que
 * dependen de reglas de tier (buyer_agent_commission) o de otros campos (datos del
 * inquilino): esos los ajusta la broker al revisar.
 */
export const CHANGEABLE_FIELDS = {
  list_price: { kind: "int", min: 1, max: 1_000_000_000 },
  address_street: { kind: "text", max: 200 },
  address_city: { kind: "text", max: 100 },
  address_zip: { kind: "text", max: 10, pattern: /^\d{5}(-\d{4})?$/ },
  property_type: { kind: "enum", values: PROPERTY_TYPES },
  bedrooms: { kind: "int", min: 0, max: 30 },
  bathrooms: { kind: "number", min: 0.5, max: 30, step: 0.5 },
  sqft: { kind: "int", min: 1, max: 100_000 },
  lot_size: { kind: "int", min: 0, max: 100_000_000, nullable: true },
  year_built: { kind: "int", min: 1800, max: 9999 },
  parking_spaces: { kind: "int", min: 0, max: 50, nullable: true },
  hoa_fee: { kind: "int", min: 0, max: 100_000, nullable: true },
  description: { kind: "text", max: 5000, nullable: true },
  showing_instructions: { kind: "text", max: 2000, nullable: true },
  occupancy_status: { kind: "enum", values: OCCUPANCY_STATUSES, nullable: true },
  has_pool: { kind: "bool" },
  cash_only: { kind: "bool" },
  as_is_sale: { kind: "bool" },
} as const satisfies Record<string, FieldSpec>;

export type ChangeableField = keyof typeof CHANGEABLE_FIELDS;
export const CHANGEABLE_FIELD_NAMES = Object.keys(CHANGEABLE_FIELDS) as ChangeableField[];

/** Si cambia la dirección, el pin del mapa deja de valer: se limpia al aplicar. */
export const ADDRESS_FIELDS: readonly ChangeableField[] = ["address_street", "address_city", "address_zip"];

export type FieldValue = string | number | boolean | null;
export type ChangeSet = Partial<Record<ChangeableField, { old: FieldValue; new: FieldValue }>>;

export type ParseError =
  | { error: "invalid_body" }
  | { error: "no_changes" }
  | { error: "unknown_field"; field: string }
  | { error: "invalid_value"; field: ChangeableField };

/** Normaliza un valor según su especificación. undefined = inválido. */
export function normalizeFieldValue(field: ChangeableField, raw: unknown): FieldValue | undefined {
  const spec: FieldSpec = CHANGEABLE_FIELDS[field];
  if (raw === null || raw === "") {
    if (spec.kind === "bool") return undefined;
    return "nullable" in spec && spec.nullable ? null : undefined;
  }
  switch (spec.kind) {
    case "bool":
      return typeof raw === "boolean" ? raw : undefined;
    case "int":
    case "number": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
      if (!Number.isFinite(n)) return undefined;
      if (spec.kind === "int" && !Number.isInteger(n)) return undefined;
      const max = field === "year_built" ? thisYear() + 2 : spec.max;
      if (n < spec.min || n > max) return undefined;
      if (spec.kind === "number" && spec.step && Math.abs(n / spec.step - Math.round(n / spec.step)) > 1e-9) {
        return undefined;
      }
      return n;
    }
    case "text": {
      if (typeof raw !== "string") return undefined;
      const s = raw.trim();
      if (s === "") return "nullable" in spec && spec.nullable ? null : undefined;
      if (s.length > spec.max) return undefined;
      if ("pattern" in spec && spec.pattern && !spec.pattern.test(s)) return undefined;
      return s;
    }
    case "enum":
      return typeof raw === "string" && spec.values.includes(raw) ? raw : undefined;
  }
}

function sameValue(a: unknown, b: FieldValue): boolean {
  if (a === undefined || a === null || a === "") return b === null;
  if (typeof b === "number") return Number(a) === b;
  return a === b;
}

/**
 * Valida el cuerpo `{ changes: { campo: valorNuevo, … } }` contra el listing actual y
 * devuelve solo lo que de verdad cambia, con el valor anterior (para que la broker vea
 * el "antes → después" y lo copie a Matrix).
 */
export function parseChangeRequest(
  body: unknown,
  current: Partial<Record<ChangeableField, unknown>>,
): { ok: true; changes: ChangeSet } | ({ ok: false } & ParseError) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const raw = (body as { changes?: unknown }).changes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "invalid_body" };

  const changes: ChangeSet = {};
  for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(field in CHANGEABLE_FIELDS)) return { ok: false, error: "unknown_field", field };
    const f = field as ChangeableField;
    const next = normalizeFieldValue(f, value);
    if (next === undefined) return { ok: false, error: "invalid_value", field: f };
    const prev = current[f];
    if (sameValue(prev, next)) continue;
    changes[f] = { old: (prev ?? null) as FieldValue, new: next };
  }
  if (Object.keys(changes).length === 0) return { ok: false, error: "no_changes" };
  return { ok: true, changes };
}

/** Motivo opcional del vendedor: recortado, sin vacíos. */
export function cleanReason(raw: unknown, max = 2000): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().slice(0, max);
  return s === "" ? null : s;
}

export function canRequest(kind: ListingRequestKind, mlsStatus: string | null): boolean {
  const allowed: readonly string[] =
    kind === "change" ? CHANGE_REQUESTABLE_STATUSES : WITHDRAWAL_REQUESTABLE_STATUSES;
  return mlsStatus !== null && allowed.includes(mlsStatus);
}

/**
 * Lo que se escribe en `properties` al aprobar un cambio: los valores nuevos, y si cambia
 * la dirección, lat/lng a null (la ficha vuelve a geocodificar al renderizar).
 */
export function propertyUpdateFromChanges(changes: ChangeSet): Record<string, FieldValue> {
  const update: Record<string, FieldValue> = {};
  for (const [field, diff] of Object.entries(changes)) {
    if (!(field in CHANGEABLE_FIELDS) || !diff) continue;
    update[field] = diff.new;
  }
  if (ADDRESS_FIELDS.some((f) => f in update)) {
    update.latitude = null;
    update.longitude = null;
  }
  return update;
}

/** Texto legible del cambio para la tarea de la broker y el activity_log. */
export function describeChanges(changes: ChangeSet): string {
  return Object.entries(changes)
    .map(([f, d]) => `${f}: ${fmt(d?.old ?? null)} → ${fmt(d?.new ?? null)}`)
    .join("; ");
}

function fmt(v: FieldValue): string {
  if (v === null) return "—";
  if (typeof v === "string") return v.length > 80 ? `"${v.slice(0, 77)}…"` : `"${v}"`;
  return String(v);
}

export const BROKER_TASK_TYPE: Record<ListingRequestKind, string> = {
  change: "review_listing_change",
  withdrawal: "withdraw_listing",
};
