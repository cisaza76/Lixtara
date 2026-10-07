import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CHANGEABLE_FIELD_NAMES,
  canRequest,
  cleanReason,
  describeChanges,
  normalizeFieldValue,
  parseChangeRequest,
  propertyUpdateFromChanges,
} from "./listing-requests";

const ROOT = resolve(__dirname, "../..");
const sql = readFileSync(
  join(ROOT, "supabase/migrations/20261007170000_listing_requests_post_draft_guard.sql"), "utf8");
const sql133 = readFileSync(
  join(ROOT, "supabase/migrations/20260927120000_guard_properties_mls_status.sql"), "utf8");

function fn(src: string, name: string): string {
  const i = src.indexOf(`create or replace function public.${name}`);
  expect(i, `falta la función ${name}`).toBeGreaterThanOrEqual(0);
  return src.slice(i, src.indexOf("$$;", src.indexOf("as $$", i)) + 3);
}
const arrayCols = (body: string) =>
  [...body.slice(body.indexOf("array[")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

const writable133 = arrayCols(fn(sql133, "properties_seller_writable_columns"));
const postDraft = arrayCols(fn(sql, "properties_seller_post_draft_columns"));

describe("columnas después del borrador (#136)", () => {
  it("la lista corta es un subconjunto de la lista del borrador", () => {
    expect(postDraft.length).toBeGreaterThan(0);
    for (const c of postDraft) expect(writable133, c).toContain(c);
  });

  it("no incluye NINGÚN campo clave (los que se piden a la broker)", () => {
    for (const c of CHANGEABLE_FIELD_NAMES) expect(postDraft, c).not.toContain(c);
    for (const c of ["list_price", "address_street", "property_type", "bedrooms", "bathrooms",
                     "sqft", "description", "showing_instructions", "occupancy_status",
                     "buyer_agent_commission", "mls_status", "pricing_tier"]) {
      expect(postDraft, c).not.toContain(c);
    }
  });

  it("cada campo solicitable es una columna real que el asistente escribe", () => {
    for (const c of CHANGEABLE_FIELD_NAMES) expect(writable133, c).toContain(c);
  });

  it("el guard elige la lista por el estado ANTERIOR y pricing_tier solo en borrador", () => {
    const g = fn(sql, "guard_properties_seller_columns");
    expect(g).toContain("v_draft := coalesce(old.mls_status, 'draft') = 'draft'");
    expect(g).toContain("then public.properties_seller_writable_columns()");
    expect(g).toContain("else public.properties_seller_post_draft_columns() end");
    expect(g).toContain("not (n.key = 'pricing_tier' and v_draft)");
    // Lo de #133 se conserva.
    expect(g).toMatch(/security definer\s+set search_path = public, pg_temp/);
    expect(g).toContain("current_setting('role', true)");
    expect(g).toContain("Only an admin can change properties.is_test.");
    expect(g).toContain("new.mls_status is distinct from 'draft'");
  });

  it("el vendedor no inserta solicitudes ni tareas por la API; una pendiente por tipo", () => {
    expect(sql).toContain("revoke insert, delete, truncate on public.listing_requests from authenticated");
    expect(sql).toContain("revoke all on public.listing_requests from public, anon");
    expect(sql).toContain("on public.listing_requests (property_id, kind) where status = 'pending'");
    expect(sql).toContain("'review_listing_change', 'withdraw_listing'");
    // Conserva los tipos existentes.
    expect(sql).toContain("'enter_mls_number'");
  });
});

describe("normalizeFieldValue", () => {
  it("números con los mismos límites que el asistente", () => {
    expect(normalizeFieldValue("list_price", "480000")).toBe(480000);
    expect(normalizeFieldValue("list_price", 0)).toBeUndefined();
    expect(normalizeFieldValue("list_price", 1.5)).toBeUndefined();
    expect(normalizeFieldValue("bathrooms", 2.5)).toBe(2.5);
    expect(normalizeFieldValue("bathrooms", 2.3)).toBeUndefined();
    expect(normalizeFieldValue("year_built", new Date().getFullYear() + 3)).toBeUndefined();
    expect(normalizeFieldValue("hoa_fee", "")).toBeNull();
    expect(normalizeFieldValue("sqft", "")).toBeUndefined();
  });
  it("texto, enums y booleanos", () => {
    expect(normalizeFieldValue("address_zip", "33139")).toBe("33139");
    expect(normalizeFieldValue("address_zip", "3313")).toBeUndefined();
    expect(normalizeFieldValue("description", "  hola ")).toBe("hola");
    expect(normalizeFieldValue("description", "x".repeat(5001))).toBeUndefined();
    expect(normalizeFieldValue("property_type", "condo")).toBe("condo");
    expect(normalizeFieldValue("property_type", "castle")).toBeUndefined();
    expect(normalizeFieldValue("has_pool", true)).toBe(true);
    expect(normalizeFieldValue("has_pool", "true")).toBeUndefined();
    expect(normalizeFieldValue("has_pool", null)).toBeUndefined();
  });
});

describe("parseChangeRequest", () => {
  const current = { list_price: 500000, description: "Old", has_pool: false, hoa_fee: null };

  it("devuelve solo lo que cambia, con el valor anterior", () => {
    const r = parseChangeRequest(
      { changes: { list_price: "480000", description: "Old", has_pool: true } },
      current,
    );
    expect(r).toEqual({
      ok: true,
      changes: { list_price: { old: 500000, new: 480000 }, has_pool: { old: false, new: true } },
    });
  });

  it("rechaza campos fuera de la lista (estado, tier, mls_number…)", () => {
    for (const f of ["mls_status", "pricing_tier", "mls_number", "owner_id", "is_test", "buyer_agent_commission"]) {
      expect(parseChangeRequest({ changes: { [f]: "x" } }, current)).toEqual({ ok: false, error: "unknown_field", field: f });
    }
  });

  it("valor inválido, cuerpo inválido y sin cambios", () => {
    expect(parseChangeRequest({ changes: { list_price: -1 } }, current)).toEqual({ ok: false, error: "invalid_value", field: "list_price" });
    expect(parseChangeRequest(null, current)).toEqual({ ok: false, error: "invalid_body" });
    expect(parseChangeRequest({ changes: [] }, current)).toEqual({ ok: false, error: "invalid_body" });
    expect(parseChangeRequest({ changes: { list_price: 500000, hoa_fee: "" } }, current)).toEqual({ ok: false, error: "no_changes" });
  });
});

describe("estados", () => {
  it("cambio: enviado, activo o bajo contrato; nunca borrador ni retirado", () => {
    expect(canRequest("change", "active")).toBe(true);
    expect(canRequest("change", "pending_approval")).toBe(true);
    expect(canRequest("change", "under_contract")).toBe(true);
    for (const s of ["draft", "withdrawn", "expired", "closed", null]) expect(canRequest("change", s)).toBe(false);
  });
  it("retiro: enviado o activo; bajo contrato lo gestiona la broker", () => {
    expect(canRequest("withdrawal", "active")).toBe(true);
    expect(canRequest("withdrawal", "pending_approval")).toBe(true);
    for (const s of ["under_contract", "draft", "withdrawn", null]) expect(canRequest("withdrawal", s)).toBe(false);
  });
});

describe("aplicar y describir", () => {
  it("cambio de dirección limpia el pin del mapa", () => {
    expect(propertyUpdateFromChanges({ address_street: { old: "1 A St", new: "2 B St" } })).toEqual({
      address_street: "2 B St", latitude: null, longitude: null,
    });
    expect(propertyUpdateFromChanges({ list_price: { old: 1, new: 2 } })).toEqual({ list_price: 2 });
  });
  it("ignora claves que no son campos solicitables (defensa ante filas manipuladas)", () => {
    expect(propertyUpdateFromChanges({ mls_status: { old: "active", new: "draft" } } as never)).toEqual({});
  });
  it("describe el antes → después", () => {
    expect(describeChanges({ list_price: { old: 500000, new: 480000 }, description: { old: null, new: "x" } }))
      .toBe('list_price: 500000 → 480000; description: — → "x"');
  });
  it("motivo", () => {
    expect(cleanReason("  ")).toBeNull();
    expect(cleanReason(5)).toBeNull();
    expect(cleanReason(" ok ")).toBe("ok");
  });
});
