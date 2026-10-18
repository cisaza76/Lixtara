import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  MIN_CORRECTION_NOTE,
  isPlanPaymentSucceeded,
  mapMlsPublishedWriteError,
  markPublishedBlockers,
  parseMiamiDateTime,
  refundOnCancel,
  toMiamiDateTimeInput,
} from "./mls-published";

// La garantía real es el guard de la migración 20261018170000, verificado contra Postgres
// (PGlite, 23 casos, en la descripción del PR). Estos tests anclan en CI lo que el código y la
// migración deben seguir diciendo.
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const migration = read("supabase/migrations/20261018170000_properties_mls_published_at_guard.sql");
const crmView = read("supabase/migrations/20261018170100_crm_sendable_exclude_foreign.sql");

describe("reembolso según la fecha de publicación", () => {
  it("sin fecha, reembolso total; con fecha, la tarifa está devengada", () => {
    expect(refundOnCancel(null)).toBe("full");
    expect(refundOnCancel(undefined)).toBe("full");
    expect(refundOnCancel("2026-10-18T15:00:00Z")).toBe("flat_fee_earned");
  });
});

describe("marcar como publicado en el MLS", () => {
  const ready = { publishedAt: null, mlsNumber: "A11234567", agreementStatus: "completed", planPaymentSucceeded: true };

  it("sin bloqueos con acuerdo completed, pago del plan y número", () => {
    expect(markPublishedBlockers(ready)).toEqual([]);
  });

  it("acuerdo solo firmado por el vendedor, pago pendiente o sin número: bloqueado", () => {
    expect(markPublishedBlockers({ ...ready, agreementStatus: "signed" })).toEqual(["agreement_not_completed"]);
    expect(markPublishedBlockers({ ...ready, agreementStatus: null })).toEqual(["agreement_not_completed"]);
    expect(markPublishedBlockers({ ...ready, planPaymentSucceeded: false })).toEqual(["payment_not_succeeded"]);
    expect(markPublishedBlockers({ ...ready, mlsNumber: null })).toEqual(["mls_number_required"]);
  });

  it("con fecha ya fijada no se vuelve a marcar", () => {
    expect(markPublishedBlockers({ ...ready, publishedAt: "2026-10-18T15:00:00Z" })).toEqual(["already_published"]);
  });

  it("el pago que cuenta es el del plan (flat_fee con tier), no la fotografía", () => {
    expect(isPlanPaymentSucceeded([{ payment_type: "flat_fee", tier: null, status: "succeeded" }])).toBe(false);
    expect(isPlanPaymentSucceeded([{ payment_type: "flat_fee", tier: "pro", status: "pending" }])).toBe(false);
    expect(isPlanPaymentSucceeded([{ payment_type: "flat_fee", tier: "pro", status: "succeeded" }])).toBe(true);
  });

  it("traduce los errores del guard", () => {
    const e = (message: string, code?: string) => mapMlsPublishedWriteError({ message, code });
    expect(e("mls_published_at requires the MLS number.")).toBe("mls_number_required");
    expect(e("mls_published_at requires the listing agreement to be completed.")).toBe("agreement_not_completed");
    expect(e("mls_published_at requires the plan payment to have succeeded.")).toBe("payment_not_succeeded");
    expect(e("mls_published_at cannot be in the future.")).toBe("future_date");
    expect(e("Correcting mls_published_at requires a note (at least 10 characters).")).toBe("note_required");
    expect(e("Only an admin can correct mls_published_at once it is set.")).toBe("admin_only");
    expect(e("duplicate key", "23505")).toBe("taken");
    expect(e("boom")).toBe("failed");
    expect(mapMlsPublishedWriteError(null)).toBeNull();
  });
});

describe("hora de Miami en la corrección", () => {
  it("lee el datetime-local como hora de Miami, con y sin horario de verano", () => {
    expect(parseMiamiDateTime("2026-10-18T10:00")).toBe("2026-10-18T14:00:00.000Z"); // EDT
    expect(parseMiamiDateTime("2026-12-01T10:00")).toBe("2026-12-01T15:00:00.000Z"); // EST
    expect(parseMiamiDateTime("ayer")).toBeNull();
    expect(toMiamiDateTimeInput("2026-10-18T14:00:00Z")).toBe("2026-10-18T10:00");
    expect(toMiamiDateTimeInput("2026-12-01T15:00:00Z")).toBe("2026-12-01T10:00");
  });
});

describe("migración 20261018170000: guard de mls_published_at", () => {
  it("no agrega columnas a properties (ya existe y ya tiene su grant de lectura)", () => {
    expect(migration).not.toMatch(/alter table (?:only )?(?:public\.)?properties\b[^;]*add column/i);
    expect(read("supabase/migrations/20260520151434_remote_baseline.sql")).toContain(
      "mls_published_at timestamp with time zone",
    );
  });

  it("exige número, acuerdo completed y pago del plan succeeded para marcar", () => {
    expect(migration).toContain("new.mls_number is null");
    expect(migration).toContain("a.status = 'completed'");
    expect(migration).toMatch(/p\.payment_type = 'flat_fee'\s+and p\.tier is not null[^\n]*\n\s+and p\.status = 'succeeded'/);
    expect(migration).toContain("public.is_admin_or_broker()");
  });

  it("una vez fijada, solo un admin la corrige, con nota y rastro", () => {
    expect(migration).toContain("if not public.has_role('admin') then");
    expect(migration).toContain(`char_length(v_note) < ${MIN_CORRECTION_NOTE}`);
    expect(migration).toContain("alter table public.property_status_history add column if not exists note text;");
    expect(migration).toContain("nullif(btrim(current_setting('lixtara.status_note', true)), '')");
    expect(migration).toContain(
      "revoke execute on function public.correct_property_mls_published_at(uuid, timestamptz, text) from public, anon;",
    );
  });

  it("service_role no la escribe: la fija una persona", () => {
    expect(migration).toContain("if v_role <> 'authenticated' then");
  });

  it("el admin la escribe con la sesión, nunca con el service-role", () => {
    const server = read("src/lib/mls-published.server.ts");
    expect(server).not.toContain("createService");
    const review = read("src/app/[lang]/admin/listings/[id]/review/page.tsx");
    expect(review).toContain("Mark as published on the MLS");
    expect(review).toContain("const { sb, userId } = await assertStaffWithUser(lang);");
  });

  it("la lista y la ficha del admin muestran la fecha y el número", () => {
    const list = read("src/app/[lang]/admin/listings/page.tsx");
    expect(list).toContain("mls_number,mls_published_at");
    expect(list).toContain("On MLS since (ET)");
    expect(read("src/app/[lang]/admin/listings/[id]/review/page.tsx")).toContain("mls_number,mls_published_at");
  });
});

describe("migración 20261018170100: correo frío solo a domicilios en EE. UU.", () => {
  it("la vista de envío excluye domicilio FC y la marca de extranjero (personas y entidades)", () => {
    expect(crmView).toContain("create or replace view public.crm_sendable_email_owners");
    expect(crmView).toContain("and not o.is_foreign");
    expect(crmView).toContain("and upper(btrim(coalesce(o.domicile, ''))) <> 'FC'");
    // Sin excepción por tipo de propietario: las entidades extranjeras también quedan fuera.
    expect(crmView).not.toMatch(/owner_type\s*(?:=|<>|in)/);
  });

  it("conserva las demás exclusiones y la vista sigue de solo lectura", () => {
    for (const s of [
      "o.email_verified_at is not null",
      "o.outreach_status not in ('Baja','Rebote','No interesado','Persona equivocada')",
      "from public.crm_suppression s",
      "p.mls_status ilike 'activo%'",
      "with (security_invoker = true)",
      "revoke all on public.crm_sendable_email_owners from anon;",
    ]) expect(crmView).toContain(s);
  });
});
