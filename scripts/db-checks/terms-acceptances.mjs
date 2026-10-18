// Verifica 20261019120000_terms_acceptances contra un Postgres 17 real en memoria (PGlite): sin
// Docker y NUNCA contra producción. Mismos casos que terms-acceptances.sql (la versión con
// Docker del #203): réplica mínima → migración (dos veces: idempotente) → casos → reversión →
// re-aplicación. Sale con código 1 si alguno no coincide.
//   pnpm db-check:terms-acceptances
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const sql = (p) => readFileSync(join(ROOT, p), "utf8");
const MIG = "supabase/migrations/20261019120000_terms_acceptances.sql";
const ROLLBACK = "docs/superpowers/runbooks/rollback-20261019120000_terms_acceptances.sql";
const ADMIN = "11111111-1111-4111-8111-111111111111";
const SELLER = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const PROP = "aaaaaaaa-0000-4000-8000-000000000001";
const HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create type public.app_role as enum ('admin','broker','photographer');
create table public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null, role public.app_role not null);
create function public.is_admin_or_broker() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin','broker')) $$;
create table public.properties (id uuid primary key default gen_random_uuid(), owner_id uuid not null);
insert into auth.users (id) values ('${ADMIN}'), ('${SELLER}'), ('${OTHER}');
insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');
insert into public.properties (id, owner_id) values ('${PROP}', '${SELLER}');
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

const cases = [];
const chk = (caso, esperado, obtenido) => cases.push({ caso, esperado, obtenido, ok: obtenido === esperado ? "ok" : "*** FALLA ***" });
const ins = (cols, vals) => `insert into public.terms_acceptances (${cols}) values (${vals})`;

chk("service_role inserta la aceptación del paso 8", "OK:1", await as("service_role", null, ins(
  "user_id, property_id, document, version, lang, consent_text_hash, context, stripe_checkout_session_id, ip_address, user_agent",
  `'${SELLER}', '${PROP}', 'terms_refund', '2026-10-18-v1', 'es', '${HASH}', 'checkout_tier', 'cs_test_abc123', '203.0.113.7', 'Mozilla/5.0'`)));
chk("service_role inserta E-SIGN", "OK:1", await as("service_role", null, ins(
  "user_id, property_id, document, version, lang, consent_text_hash, context",
  `'${OTHER}', '${PROP}', 'esign', '2026-10-18-v1', 'en', '${HASH}', 'step7_esign'`)));
chk("service_role inserta la aceptación de Términos y Privacidad al crear la cuenta", "OK:1", await as("service_role", null, ins(
  "user_id, document, version, lang, consent_text_hash, context, ip_address, user_agent",
  `'${OTHER}', 'terms', 'terms-2026-10-18-v1+privacy-2026-10-18-v1', 'en', '${HASH}', 'signup', '2001:db8::1', 'Mozilla/5.0'`)));
chk("el vendedor NO puede insertar (ni falsear su aceptación)", "ERR:42501", await as("authenticated", SELLER, ins(
  "user_id, document, version, lang, consent_text_hash, context", `'${SELLER}', 'terms_refund', 'x', 'es', '${HASH}', 'checkout_tier'`)));
chk("anon no puede leer", "ERR:42501", await as("anon", null, "select 1 from public.terms_acceptances"));
chk("el vendedor ve solo sus filas", "OK:1", await as("authenticated", SELLER, "select 1 from public.terms_acceptances"));
chk("admin ve todas", "OK:3", await as("authenticated", ADMIN, "select 1 from public.terms_acceptances"));
chk("nadie edita (ni service_role)", "ERR:42501", await as("service_role", null, "update public.terms_acceptances set version = 'otra'"));
chk("nadie borra (ni service_role)", "ERR:42501", await as("service_role", null, "delete from public.terms_acceptances"));
chk("el vendedor tampoco edita", "ERR:42501", await as("authenticated", SELLER, "update public.terms_acceptances set lang = 'en'"));
chk("hash que no es SHA-256 hex → rechazo", "ERR:23514", await as("service_role", null, ins(
  "document, version, lang, consent_text_hash, context", "'terms_refund','v','es','abc','checkout_tier'")));
chk("documento desconocido → rechazo", "ERR:23514", await as("service_role", null, ins(
  "document, version, lang, consent_text_hash, context", `'otro','v','es','${HASH}','x'`)));
chk("idioma fuera de en/es → rechazo", "ERR:23514", await as("service_role", null, ins(
  "document, version, lang, consent_text_hash, context", `'esign','v','fr','${HASH}','x'`)));
chk("IP inválida → rechazo", "ERR:22P02", await as("service_role", null, ins(
  "document, version, lang, consent_text_hash, context, ip_address", `'esign','v','en','${HASH}','x','no-es-ip'`)));

await db.exec(`delete from public.properties where id = '${PROP}'`);
chk("borrar la propiedad: la prueba queda, property_id NULL", "3:0",
  (await db.query("select count(*)::int || ':' || count(property_id)::int as r from public.terms_acceptances")).rows[0].r);
await db.exec(`delete from auth.users where id = '${SELLER}'`);
chk("borrar el usuario: la prueba queda, user_id NULL", "3:2",
  (await db.query("select count(*)::int || ':' || count(user_id)::int as r from public.terms_acceptances")).rows[0].r);

await db.exec(sql(ROLLBACK));
chk("rollback: la tabla ya no existe", "null",
  String((await db.query("select to_regclass('public.terms_acceptances') as t")).rows[0].t));
await db.exec(sql(MIG));
chk("re-aplicación tras el rollback", "terms_acceptances",
  String((await db.query("select to_regclass('public.terms_acceptances') as t")).rows[0].t));

console.table(cases);
const fallas = cases.filter((c) => c.ok !== "ok").length;
console.log(fallas === 0 ? `\nterms-acceptances: ${cases.length} casos OK` : `\n${fallas} FALLA(S)`);
process.exit(fallas === 0 ? 0 : 1);
