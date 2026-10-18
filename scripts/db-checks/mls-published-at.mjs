// Verifica el guard de properties.mls_published_at (migraciones 20261018170000 y
// 20261018190000) contra un Postgres 17 real en memoria (PGlite): sin Docker y NUNCA contra
// producción. Réplica mínima de Supabase: roles de la API, auth.uid(), user_roles/has_role(),
// is_admin_or_broker(), RLS de properties, agreements y payments. Los casos corren con
// `SET LOCAL ROLE`, igual que PostgREST. Sale con código 1 si alguno no coincide.
//   pnpm db-check:mls-published-at
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const sql = (p) => readFileSync(join(ROOT, p), "utf8");
const SELLER = "11111111-1111-4111-8111-111111111111";
const BROKER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const P = "aaaaaaaa-0000-4000-8000-000000000001";

const replica = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create type public.app_role as enum ('admin','broker','photographer');
create table public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null, role public.app_role not null);
create function public.has_role(_role public.app_role) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = _role) $$;
create function public.is_admin_or_broker() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin','broker')) $$;
create table public.properties (id uuid primary key default gen_random_uuid(), owner_id uuid not null, list_price numeric,
  pricing_tier text, mls_number text unique, mls_status text default 'draft', mls_published_at timestamptz,
  mls_expires_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
alter table public.properties enable row level security;
create policy "Brokers can view all properties" on public.properties using (public.is_admin_or_broker());
create policy "Users can update own properties" on public.properties for update using (auth.uid() = owner_id);
create policy "Users can view own properties" on public.properties for select using (auth.uid() = owner_id);
create table public.agreements (id uuid primary key default gen_random_uuid(), property_id uuid not null, owner_id uuid, status text, signed_at timestamptz);
create table public.payments (id uuid primary key default gen_random_uuid(), property_id uuid, user_id uuid, payment_type text, tier text, status text,
  completed_at timestamptz, stripe_payment_intent_id text, stripe_charge_id text, receipt_url text);
insert into public.user_roles (user_id, role) values ('${BROKER}','broker'), ('${ADMIN}','admin');
insert into public.properties (id, owner_id, mls_status) values ('${P}', '${SELLER}', 'pending_approval');
`;

const db = new PGlite();
await db.exec(replica);
await db.exec(sql("supabase/migrations/20260927120000_guard_properties_mls_status.sql"));
for (const m of ["20261018170000_properties_mls_published_at_guard.sql", "20261018190000_mls_published_requires_active.sql"]) {
  await db.exec(sql(`supabase/migrations/${m}`));
  await db.exec(sql(`supabase/migrations/${m}`)); // idempotente
}

async function as(role, uid, text) {
  try {
    await db.exec("begin");
    if (role) await db.exec(`set local role ${role}`);
    if (uid) await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid })]);
    const r = await db.query(text);
    await db.exec("commit");
    return "OK" + (r.affectedRows !== undefined ? ` (${r.affectedRows})` : "");
  } catch (e) {
    await db.exec("rollback");
    return "ERR " + e.message;
  }
}

const cases = [];
const run = async (name, role, uid, text, expected) => {
  const got = await as(role, uid, text);
  cases.push({ caso: name, resultado: got.slice(0, 72), ok: got.startsWith(expected) ? "ok" : "*** FALLA ***" });
};
const mark = `update public.properties set mls_published_at = now() where id = '${P}'`;
const setup = (s) => db.exec(s);

await run("pending_approval, sin número", "authenticated", BROKER, mark, "ERR mls_published_at requires the listing to be approved");
await run("broker pone número", "authenticated", BROKER, `update public.properties set mls_number='A11234567' where id='${P}'`, "OK (1)");
await setup(`insert into public.agreements (property_id, status) values ('${P}', 'completed')`);
await setup(`insert into public.payments (property_id, payment_type, tier, status) values ('${P}', 'flat_fee', 'pro', 'succeeded')`);
await run("broker marca en pending_approval (número, acuerdo y pago OK)", "authenticated", BROKER, mark, "ERR mls_published_at requires the listing to be approved");
await run("broker aprueba y marca en la misma escritura", "authenticated", BROKER,
  `update public.properties set mls_status = 'active', mls_published_at = now() where id='${P}'`, "OK (1)");
await run("admin corrige con nota en pending (sin exigir active)", "authenticated", ADMIN,
  `select public.correct_property_mls_published_at('${P}', now() - interval '1 day', 'fecha real según Matrix')`, "OK");
await setup(`update public.properties set mls_published_at = null, mls_status = 'pending_approval'`);
await setup(`update public.properties set mls_status = 'active', mls_number = null`);
await setup(`delete from public.agreements; delete from public.payments`);
await run("activo, sin número", "authenticated", BROKER, mark, "ERR mls_published_at requires the MLS number");
await run("broker pone número", "authenticated", BROKER, `update public.properties set mls_number='A11234567' where id='${P}'`, "OK (1)");
await run("activo, sin acuerdo completed", "authenticated", BROKER, mark, "ERR mls_published_at requires the listing agreement");
await setup(`insert into public.agreements (property_id, status) values ('${P}', 'signed')`);
await run("activo, acuerdo solo signed", "authenticated", BROKER, mark, "ERR mls_published_at requires the listing agreement");
await setup(`update public.agreements set status='completed'`);
await run("activo, sin pago", "authenticated", BROKER, mark, "ERR mls_published_at requires the plan payment");
await setup(`insert into public.payments (property_id, payment_type, tier, status) values ('${P}', 'flat_fee', null, 'succeeded'), ('${P}', 'flat_fee', 'pro', 'pending')`);
await run("activo, solo fotografía pagada / plan pending", "authenticated", BROKER, mark, "ERR mls_published_at requires the plan payment");
await setup(`update public.payments set status='succeeded' where tier='pro'`);
await run("vendedor marca", "authenticated", SELLER, mark, "ERR Only a broker or admin can set");
await run("service_role marca", "service_role", null, mark, "ERR Only a broker or admin can set");
await run("broker marca en el futuro", "authenticated", BROKER,
  `update public.properties set mls_published_at = now() + interval '2 days' where id='${P}'`, "ERR mls_published_at cannot be in the future");
await run("broker marca OK", "authenticated", BROKER, mark, "OK (1)");
await run("broker edita la fecha", "authenticated", BROKER,
  `update public.properties set mls_published_at = now() - interval '1 day' where id='${P}'`, "ERR Only an admin can correct");
await run("broker borra la fecha", "authenticated", BROKER,
  `update public.properties set mls_published_at = null where id='${P}'`, "ERR Only an admin can correct");
await run("admin edita directo (sin nota)", "authenticated", ADMIN,
  `update public.properties set mls_published_at = now() - interval '1 day' where id='${P}'`, "ERR Correcting mls_published_at requires a note");
await run("broker usa la RPC", "authenticated", BROKER,
  `select public.correct_property_mls_published_at('${P}', now() - interval '1 day', 'typo en la fecha de Matrix')`, "ERR Only an admin can correct");
await run("admin RPC nota corta", "authenticated", ADMIN,
  `select public.correct_property_mls_published_at('${P}', now() - interval '1 day', 'corto')`, "ERR Correcting mls_published_at requires a note");
await run("admin RPC OK", "authenticated", ADMIN,
  `select public.correct_property_mls_published_at('${P}', now() - interval '1 day', 'Matrix muestra la fecha del día anterior')`, "OK");
await run("anon RPC", "anon", null, `select public.correct_property_mls_published_at('${P}', now(), 'xxxxxxxxxxxxxxx')`, "ERR permission denied");
await run("vendedor inserta con fecha", "authenticated", SELLER,
  `insert into public.properties (owner_id, mls_published_at) values ('${SELLER}', now())`, "ERR");
await run("broker inserta con fecha", "authenticated", BROKER,
  `insert into public.properties (owner_id, mls_published_at) values ('${SELLER}', now())`, "ERR mls_published_at is set from the admin");
await run("broker cambia precio (no toca fecha)", "authenticated", BROKER, `update public.properties set list_price = 5 where id='${P}'`, "OK (1)");
await run("postgres (SQL Editor) corrige", null, null,
  `update public.properties set mls_published_at = now() - interval '3 days' where id='${P}'`, "OK (1)");
await run("anon ejecuta el guard", "anon", null, `select public.guard_properties_mls_published_at()`, "ERR");

console.table(cases);
console.table((await db.query(
  `select old_status, new_status, old_published_at is not null as old_set, new_published_at is not null as new_set, changed_by, note
     from public.property_status_history order by id`)).rows);

// Rollback de 20261018190000: vuelve a permitir marcar sin active.
await db.exec(sql("docs/superpowers/runbooks/rollback-20261018190000_mls_published_requires_active.sql"));
await db.exec(`update public.properties set mls_published_at = null, mls_status = 'pending_approval'`);
const tras = await as("authenticated", BROKER, mark);
console.log("tras el rollback de 20261018190000, marcar en pending_approval:", tras);
const fallas = cases.filter((c) => c.ok !== "ok").length + (tras.startsWith("OK") ? 0 : 1);
console.log(fallas === 0 ? `\n${cases.length} casos OK` : `\n${fallas} FALLA(S)`);
process.exit(fallas === 0 ? 0 : 1);
