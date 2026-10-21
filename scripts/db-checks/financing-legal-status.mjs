// Verifica 20261021120000_financing_terms_agreement_legal_status contra un Postgres 17 en
// memoria (PGlite): sin Docker y NUNCA contra producción. Réplica mínima (roles, auth.uid(),
// properties, agreements con su política de inserción) → migración (dos veces: idempotente) →
// casos → reversión → re-aplicación. Sale con código 1 si alguno no coincide.
//   pnpm db-check:financing-legal-status
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const sql = (p) => readFileSync(join(ROOT, p), "utf8");
const MIG = "supabase/migrations/20261021120000_financing_terms_agreement_legal_status.sql";
const ROLLBACK = "scripts/sql/rollback_20261021120000_financing_terms_agreement_legal_status.sql";
const SELLER = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const PROP = "aaaaaaaa-0000-4000-8000-000000000001";
const OLD = "aaaaaaaa-0000-4000-8000-000000000002";

const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
create table public.properties (id uuid primary key default gen_random_uuid(), owner_id uuid not null, cash_only boolean default false);
grant select, insert, update on public.properties to anon, authenticated, service_role;
create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  template_id text not null default 't', envelope_id text unique,
  status text not null default 'pending', signer_email text not null default 's@x', signer_name text not null default 'S',
  signed_at timestamptz, created_at timestamptz not null default now());
alter table public.agreements enable row level security;
create policy "own agreements insert" on public.agreements for insert to public
  with check (auth.uid() = owner_id and status in ('pending', 'sent') and signed_at is null
    and exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()));
create policy "own agreements select" on public.agreements for select to public using (auth.uid() = owner_id);
grant select, insert, update on public.agreements to anon, authenticated, service_role;
insert into auth.users (id) values ('${SELLER}'), ('${OTHER}');
insert into public.properties (id, owner_id, cash_only) values ('${PROP}', '${SELLER}', true), ('${OLD}', '${SELLER}', false);
-- Un acuerdo anterior a la migración (queda con legal_description_status null).
insert into public.agreements (property_id, owner_id, envelope_id) values ('${OLD}', '${SELLER}', 'env-old');
`);
await db.exec(sql(MIG));
await db.exec(sql(MIG)); // idempotente

async function as(role, sub, text) {
  try {
    await db.exec("begin");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? ""]);
    await db.exec(`set local role ${role}`);
    const r = await db.query(text);
    await db.exec("commit");
    return `OK:${r.affectedRows || r.rows.length}`;
  } catch (e) {
    await db.exec("rollback");
    return `ERR:${e.code ?? e.message}`;
  }
}
const one = async (q) => (await db.query(q)).rows[0];

const cases = [];
const chk = (caso, esperado, obtenido) => cases.push({ caso, esperado, obtenido, ok: obtenido === esperado ? "ok" : "*** FALLA ***" });
const fin = (terms, other) => `update public.properties set financing_terms = ${terms}, financing_other = ${other} where id = '${PROP}'`;
const agr = (status, env) => `insert into public.agreements (property_id, owner_id, envelope_id, legal_description_status) values ('${PROP}', '${SELLER}', '${env}', ${status})`;

// ── A. Financiación ──
chk("relleno: cash_only = true → {cash}", "{cash}", (await one(`select financing_terms::text as t from public.properties where id = '${PROP}'`)).t);
chk("relleno: cash_only = false → null", "null", String((await one(`select financing_terms as t from public.properties where id = '${OLD}'`)).t));
chk("Cash + Conventional", "OK:1", await as("authenticated", SELLER, fin("array['cash','conventional']", "null")));
chk("Other con texto", "OK:1", await as("authenticated", SELLER, fin("array['other']", "'Seller financing 20% down'")));
chk("Other sin texto → rechazo", "ERR:23514", await as("authenticated", SELLER, fin("array['other']", "null")));
chk("Other con texto en blanco → rechazo", "ERR:23514", await as("authenticated", SELLER, fin("array['other']", "'   '")));
chk("texto sin Other → rechazo", "ERR:23514", await as("authenticated", SELLER, fin("array['cash']", "'x'")));
chk("texto de 121 caracteres → rechazo", "ERR:23514", await as("authenticated", SELLER, fin("array['other']", `'${"x".repeat(121)}'`)));
chk("texto de 120 caracteres", "OK:1", await as("authenticated", SELLER, fin("array['other']", `'${"x".repeat(120)}'`)));
chk("valor desconocido (crypto) → rechazo", "ERR:23514", await as("authenticated", SELLER, fin("array['cash','crypto']", "null")));
chk("lista vacía → rechazo", "ERR:23514", await as("authenticated", SELLER, fin("array[]::text[]", "null")));
chk("las dos columnas están en la lista del vendedor", "true",
  String((await one("select public.properties_seller_writable_columns() @> array['financing_terms','financing_other'] as ok")).ok));
chk("anon puede leer las columnas nuevas", "OK:2", await as("anon", null, "select financing_terms, financing_other from public.properties"));

// ── B. Estado de la descripción legal ──
chk("el acuerdo anterior queda con null", "null", String((await one(`select legal_description_status as s from public.agreements where envelope_id = 'env-old'`)).s));
chk("acuerdo nuevo sin estado → rechazo (aun service_role)", "ERR:23502", await as("service_role", null, agr("null", "env-1")));
chk("estado desconocido → rechazo", "ERR:23514", await as("service_role", null, agr("'maybe'", "env-2")));
chk("service_role inserta 'verified'", "OK:1", await as("service_role", null, agr("'verified'", "env-3")));
chk("service_role inserta 'pending'", "OK:1", await as("service_role", null, agr("'pending'", "env-4")));
chk("el vendedor NO puede insertar su acuerdo como 'verified'", "ERR:42501", await as("authenticated", SELLER, agr("'verified'", "env-5")));
chk("el vendedor puede insertar 'pending'", "OK:1", await as("authenticated", SELLER, agr("'pending'", "env-6")));
chk("otro usuario no inserta en un listing ajeno", "ERR:42501", await as("authenticated", OTHER,
  `insert into public.agreements (property_id, owner_id, envelope_id, legal_description_status) values ('${PROP}', '${OTHER}', 'env-7', 'pending')`));
chk("el vendedor no puede cambiar el estado (sin política de UPDATE)", "OK:0", await as("authenticated", SELLER,
  "update public.agreements set legal_description_status = 'verified' where envelope_id = 'env-6'"));
chk("actualizar un acuerdo anterior (webhook) sigue funcionando", "OK:1", await as("service_role", null,
  "update public.agreements set status = 'signed' where envelope_id = 'env-old'"));

// ── Reversión y re-aplicación ──
await db.exec(sql(ROLLBACK));
chk("rollback: sin columnas nuevas", "0", String((await one(`select count(*)::int as n from information_schema.columns
  where (table_name = 'properties' and column_name in ('financing_terms','financing_other')) or (table_name = 'agreements' and column_name = 'legal_description_status')`)).n));
chk("rollback: la lista del vendedor sin financiación", "false",
  String((await one("select public.properties_seller_writable_columns() && array['financing_terms','financing_other'] as ok")).ok));
chk("rollback: el vendedor vuelve a insertar sin estado", "OK:1", await as("authenticated", SELLER,
  `insert into public.agreements (property_id, owner_id, envelope_id) values ('${PROP}', '${SELLER}', 'env-8')`));
await db.exec(sql(MIG));
chk("re-aplicación tras el rollback", "3", String((await one(`select count(*)::int as n from information_schema.columns
  where (table_name = 'properties' and column_name in ('financing_terms','financing_other')) or (table_name = 'agreements' and column_name = 'legal_description_status')`)).n));

console.table(cases);
const fallas = cases.filter((c) => c.ok !== "ok").length;
console.log(fallas === 0 ? `\nfinancing-legal-status: ${cases.length} casos OK` : `\n${fallas} FALLA(S)`);
process.exit(fallas === 0 ? 0 : 1);
