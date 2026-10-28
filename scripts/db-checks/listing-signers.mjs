// Verifica 20261028120000_listing_signers (#220) contra un Postgres 17 en memoria (PGlite): sin
// Docker y NUNCA contra producción. Réplica mínima (roles, auth.users/auth.uid(), user_roles e
// is_admin_or_broker(), properties, agreements con su política de 20261021120000) → migración
// (dos veces: idempotente) → casos → reversión → re-aplicación. Sale con código 1 si alguno no
// coincide.
//   pnpm db-check:listing-signers
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const sql = (p) => readFileSync(join(ROOT, p), "utf8");
const MIG = "supabase/migrations/20261028120000_listing_signers.sql";
const ROLLBACK = "scripts/sql/rollback_20261028120000_listing_signers.sql";
const SELLER = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const BROKER = "66666666-6666-4666-8666-666666666666";
const PROP = "aaaaaaaa-0000-4000-8000-000000000001";
const PROP2 = "aaaaaaaa-0000-4000-8000-000000000002";

const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
create table public.user_roles (user_id uuid not null, role text not null);
create function public.is_admin_or_broker() returns boolean language sql security definer stable
  set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin', 'broker')) $$;
grant execute on function public.is_admin_or_broker() to anon, authenticated, service_role;
create function public.update_updated_at_column() returns trigger language plpgsql as $$
  begin new.updated_at = now(); return new; end $$;
create table public.properties (id uuid primary key, owner_id uuid not null, mls_status text not null default 'draft');
grant select, insert, update on public.properties to service_role;
grant select (id, owner_id, mls_status) on public.properties to anon, authenticated;
create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  template_id text not null default 't', envelope_id text unique,
  status text not null default 'pending', signer_email text not null default 's@x', signer_name text not null default 'S',
  signed_at timestamptz, legal_description_status text default 'pending',
  created_at timestamptz not null default now());
alter table public.agreements enable row level security;
create policy "own agreements insert" on public.agreements for insert to public
  with check (auth.uid() = owner_id and status in ('pending', 'sent') and signed_at is null
    and legal_description_status = 'pending'
    and exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()));
create policy "own agreements select" on public.agreements for select to public using (auth.uid() = owner_id);
grant select, insert, update on public.agreements to anon, authenticated, service_role;
insert into auth.users (id, email) values ('${SELLER}', 'Seller@Example.com'), ('${OTHER}', 'other@example.com'), ('${BROKER}', 'broker@example.com');
insert into public.user_roles values ('${BROKER}', 'broker');
insert into public.properties (id, owner_id) values ('${PROP}', '${SELLER}'), ('${PROP2}', '${SELLER}');
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
const own = (prop, owner, extra = "") =>
  `insert into public.listing_ownership (property_id, owner_id, owner_kind, other_title_holders, married_homestead${extra ? ", " + extra.split("|")[0] : ""})
   values ('${prop}', '${owner}', 'individuals', true, false${extra ? ", " + extra.split("|")[1] : ""})`;
const upOwn = (set, prop = PROP) => `update public.listing_ownership set ${set} where property_id = '${prop}'`;
const signer = (prop, owner, email, rel = "title_holder") =>
  `insert into public.listing_additional_signers (property_id, owner_id, relationship, full_name, email, permission_confirmed_at)
   values ('${prop}', '${owner}', '${rel}', 'Maria Co-Owner', '${email}', now())`;
const agr = (env, cols = "", vals = "") =>
  `insert into public.agreements (property_id, owner_id, envelope_id${cols ? ", " + cols : ""}) values ('${PROP}', '${SELLER}', '${env}'${vals ? ", " + vals : ""})`;

// ── A. Titular ──
chk("el vendedor registra el titular de su borrador", "OK:1", await as("authenticated", SELLER, own(PROP, SELLER)));
chk("otro usuario no registra el titular de un listing ajeno (owner_id propio)", "ERR:23514", await as("authenticated", OTHER, own(PROP2, OTHER)));
chk("otro usuario no registra con el owner_id del vendedor", "ERR:42501", await as("authenticated", OTHER, own(PROP2, SELLER)));
chk("el vendedor no puede marcar Sunbiz al crear", "ERR:42501", await as("authenticated", SELLER,
  own(PROP2, SELLER, "sunbiz_status|'listed'").replace("'individuals'", "'individuals'")));
chk("el vendedor no puede marcar Sunbiz después", "ERR:42501", await as("authenticated", SELLER, upOwn("sunbiz_status = 'listed', sunbiz_checked_at = now()")));
chk("el vendedor no puede destrabar la revisión manual", "ERR:42501", await as("authenticated", SELLER, upOwn("manual_review_cleared_at = now()")));
chk("entidad sin nombre → rechazo", "ERR:23514", await as("authenticated", SELLER, upOwn("owner_kind = 'fl_entity'")));
chk("entidad completa (nombre, cargo, autoridad declarada)", "OK:1", await as("authenticated", SELLER,
  upOwn("owner_kind = 'fl_entity', entity_name = 'Sunset Holdings LLC', entity_signer_title = 'Managing Member', entity_authority_confirmed_at = now()")));
chk("revisión manual sin motivo → rechazo", "ERR:23514", await as("authenticated", SELLER,
  upOwn("owner_kind = 'manual_review', entity_name = null, entity_signer_title = null, entity_authority_confirmed_at = null")));
chk("la broker marca Sunbiz 'listed' con quién y cuándo", "OK:1", await as("authenticated", BROKER,
  upOwn(`sunbiz_status = 'listed', sunbiz_checked_by = '${BROKER}', sunbiz_checked_at = now()`)));
chk("Sunbiz marcado sin fecha → rechazo", "ERR:23514", await as("authenticated", BROKER, upOwn("sunbiz_status = 'not_listed', sunbiz_checked_at = null")));
chk("la broker marca el documento de autoridad recibido", "OK:1", await as("authenticated", BROKER,
  upOwn(`authority_document_received_at = now(), authority_document_received_by = '${BROKER}'`)));
chk("la broker NO cambia los datos del vendedor", "ERR:42501", await as("authenticated", BROKER, upOwn("entity_name = 'Otra LLC'")));
chk("la broker NO crea el titular", "ERR:42501", await as("authenticated", BROKER, own(PROP2, SELLER)));
chk("Sunbiz en personas físicas → rechazo (aun service_role)", "ERR:23514", await as("service_role", null,
  upOwn("owner_kind = 'individuals', entity_name = null, entity_signer_title = null, entity_authority_confirmed_at = null")));
chk("owner_id distinto del dueño → rechazo (aun service_role)", "ERR:23514", await as("service_role", null, upOwn(`owner_id = '${OTHER}'`)));
chk("anon no lee titulares", "ERR:42501", await as("anon", null, "select * from public.listing_ownership"));
chk("otro usuario no ve el titular ajeno", "OK:0", await as("authenticated", OTHER, "select * from public.listing_ownership"));
chk("la broker lee el titular", "OK:1", await as("authenticated", BROKER, "select * from public.listing_ownership"));
chk("el vendedor lee su titular", "OK:1", await as("authenticated", SELLER, "select * from public.listing_ownership"));

// ── B. Segundo firmante ──
chk("el vendedor agrega al copropietario", "OK:1", await as("authenticated", SELLER, signer(PROP, SELLER, "maria@example.com")));
chk("un segundo firmante adicional en el mismo listing → rechazo (v1: uno)", "ERR:23505", await as("authenticated", SELLER, signer(PROP, SELLER, "otro@example.com")));
chk("email del propio vendedor (mayúsculas) → rechazo", "ERR:23514", await as("authenticated", SELLER, signer(PROP2, SELLER, " seller@EXAMPLE.com")));
chk("email inválido → rechazo", "ERR:23514", await as("authenticated", SELLER, signer(PROP2, SELLER, "maria-at-example")));
chk("relación desconocida → rechazo", "ERR:23514", await as("authenticated", SELLER, signer(PROP2, SELLER, "x@example.com", "cousin")));
chk("otro usuario no agrega firmantes a un listing ajeno", "ERR:23514", await as("authenticated", OTHER, signer(PROP2, OTHER, "x@example.com")));
chk("anon no lee firmantes", "ERR:42501", await as("anon", null, "select * from public.listing_additional_signers"));
chk("otro usuario no ve el firmante ajeno", "OK:0", await as("authenticated", OTHER, "select * from public.listing_additional_signers"));
chk("la broker lee el firmante", "OK:1", await as("authenticated", BROKER, "select * from public.listing_additional_signers"));
chk("la broker NO cambia el firmante (sin política de UPDATE: 0 filas)", "OK:0", await as("authenticated", BROKER,
  `update public.listing_additional_signers set email = 'hack@example.com' where property_id = '${PROP}'`));
chk("…y el email sigue igual", "maria@example.com", (await one(`select email from public.listing_additional_signers where property_id = '${PROP}'`)).email);
chk("el vendedor corrige el email en borrador", "OK:1", await as("authenticated", SELLER,
  `update public.listing_additional_signers set email = 'maria.co@example.com' where property_id = '${PROP}'`));

// ── C. agreements ──
chk("acuerdo con 2 vendedores y un firmante guardado", "OK:1", await as("authenticated", SELLER,
  agr("env-2", "sellers_required, signing_deadline_at", "2, now() + interval '7 days'")));
chk("sellers_required = 1 con un firmante guardado → rechazo", "ERR:42501", await as("authenticated", SELLER, agr("env-3", "sellers_required", "1")));
chk("código de main (sin columnas nuevas) con firmante guardado → rechazo", "ERR:42501", await as("authenticated", SELLER, agr("env-4")));
chk("el dueño no crea el acuerdo con la segunda firma hecha", "ERR:42501", await as("authenticated", SELLER,
  agr("env-5", "sellers_required, additional_signer_signed_at", "2, now()")));
chk("el dueño no crea el acuerdo con recordatorios enviados", "ERR:42501", await as("authenticated", SELLER,
  agr("env-6", "sellers_required, reminders_sent", "2, 1")));
chk("plazo de 30 días → rechazo", "ERR:42501", await as("authenticated", SELLER,
  agr("env-7", "sellers_required, signing_deadline_at", "2, now() + interval '30 days'")));
chk("el dueño no cambia el acuerdo (sin política de UPDATE)", "OK:0", await as("authenticated", SELLER,
  "update public.agreements set additional_signer_signed_at = now() where envelope_id = 'env-2'"));
chk("service_role registra la segunda firma (webhook)", "OK:1", await as("service_role", null,
  "update public.agreements set additional_signer_signed_at = now(), reminders_sent = 2 where envelope_id = 'env-2'"));
chk("3 recordatorios → rechazo", "ERR:23514", await as("service_role", null, "update public.agreements set reminders_sent = 3 where envelope_id = 'env-2'"));
chk("3 vendedores → rechazo", "ERR:23514", await as("service_role", null, "update public.agreements set sellers_required = 3 where envelope_id = 'env-2'"));
chk("segunda firma con un solo vendedor → rechazo", "ERR:23514", await as("service_role", null,
  "update public.agreements set sellers_required = 1 where envelope_id = 'env-2'"));
chk("sin firmante adicional, el código de main sigue creando acuerdos (sellers_required = 1)", "OK:1", await as("authenticated", SELLER,
  `insert into public.agreements (property_id, owner_id, envelope_id) values ('${PROP2}', '${SELLER}', 'env-main')`));

// ── D. Fuera de borrador ──
await db.exec(`update public.properties set mls_status = 'pending_approval' where id = '${PROP}'`);
chk("enviado: el vendedor ya no cambia el titular", "ERR:42501", await as("authenticated", SELLER, upOwn("married_homestead = true")));
chk("enviado: el vendedor ya no cambia el firmante", "ERR:42501", await as("authenticated", SELLER,
  `update public.listing_additional_signers set full_name = 'Otro Nombre' where property_id = '${PROP}'`));
chk("enviado: el vendedor ya no borra el firmante", "ERR:42501", await as("authenticated", SELLER,
  `delete from public.listing_additional_signers where property_id = '${PROP}'`));
chk("enviado: la broker sigue marcando Sunbiz", "OK:1", await as("authenticated", BROKER,
  upOwn(`sunbiz_status = 'not_listed', sunbiz_checked_by = '${BROKER}', sunbiz_checked_at = now()`)));
chk("updated_at se actualiza", "true", String((await one(`select updated_at > created_at as ok from public.listing_ownership where property_id = '${PROP}'`)).ok));
chk("borrar el listing borra titular y firmante", "0", await (async () => {
  await db.exec(`delete from public.agreements where property_id = '${PROP}'; delete from public.properties where id = '${PROP}'`);
  const r = await one(`select (select count(*) from public.listing_ownership where property_id = '${PROP}')
    + (select count(*) from public.listing_additional_signers where property_id = '${PROP}') as n`);
  return String(r.n);
})());

// ── Reversión y re-aplicación ──
await db.exec(sql(ROLLBACK));
chk("rollback: sin tablas nuevas", "0", String((await one(`select count(*)::int as n from information_schema.tables
  where table_schema = 'public' and table_name in ('listing_ownership', 'listing_additional_signers')`)).n));
chk("rollback: sin columnas nuevas en agreements", "0", String((await one(`select count(*)::int as n from information_schema.columns
  where table_name = 'agreements' and column_name in ('sellers_required','additional_signer_signed_at','signing_deadline_at','reminders_sent')`)).n));
chk("rollback: sin el guard", "0", String((await one(`select count(*)::int as n from pg_proc where proname = 'guard_listing_signers'`)).n));
chk("rollback: el vendedor vuelve a crear acuerdos como en main", "OK:1", await as("authenticated", SELLER,
  `insert into public.agreements (property_id, owner_id, envelope_id) values ('${PROP2}', '${SELLER}', 'env-after-rollback')`));
await db.exec(sql(MIG));
chk("re-aplicación tras el rollback", "6", String((await one(`select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('listing_ownership', 'listing_additional_signers'))
  + (select count(*) from information_schema.columns where table_name = 'agreements'
     and column_name in ('sellers_required','additional_signer_signed_at','signing_deadline_at','reminders_sent')) as n`)).n));

console.table(cases);
const fallas = cases.filter((c) => c.ok !== "ok").length;
console.log(fallas === 0 ? `\nlisting-signers: ${cases.length} casos OK` : `\n${fallas} FALLA(S)`);
process.exit(fallas === 0 ? 0 : 1);
