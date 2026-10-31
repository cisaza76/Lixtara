// Verifica 20261031120000_ad_attribution contra un Postgres 17 en memoria (PGlite): sin
// Docker y NUNCA contra producción. Réplica mínima (roles, auth.users) → migración (dos
// veces: idempotente) → casos → reversión → re-aplicación. Sale con código 1 si alguno falla.
//   pnpm db-check:ad-attribution
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const sql = (p) => readFileSync(join(ROOT, p), "utf8");
const MIG = "supabase/migrations/20261031120000_ad_attribution.sql";
const ROLLBACK = "scripts/sql/rollback_20261031120000_ad_attribution.sql";
const SELLER = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";

const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Como Supabase: privilegios por defecto amplios para los roles de la API en tablas nuevas.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
insert into auth.users values ('${SELLER}'), ('${OTHER}');
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
const ins = (user, consent, fbp, ip) =>
  `insert into public.ad_attribution (user_id, ads_consent, fbp, fbc, client_ip, client_ua) values ('${user}', '${consent}', ${fbp}, null, ${ip}, ${ip === "null" ? "null" : "'Mozilla/5.0'"})`;

chk("service_role guarda con Publicidad aceptada", "OK:1", await as("service_role", null, ins(SELLER, "granted", "'fb.1.1730000000000.123'", "'203.0.113.10'")));
chk("una fila por usuario (segundo insert → rechazo)", "ERR:23505", await as("service_role", null, ins(SELLER, "granted", "null", "null")));
chk("upsert a 'denied' borrando los identificadores", "OK:1", await as("service_role", null,
  `update public.ad_attribution set ads_consent = 'denied', fbp = null, fbc = null, client_ip = null, client_ua = null where user_id = '${SELLER}'`));
chk("'denied' con IP → rechazo", "ERR:23514", await as("service_role", null, ins(OTHER, "denied", "null", "'203.0.113.10'")));
chk("'denied' con fbp → rechazo", "ERR:23514", await as("service_role", null, ins(OTHER, "denied", "'fb.1.1730000000000.1'", "null")));
chk("'denied' sin identificadores", "OK:1", await as("service_role", null, ins(OTHER, "denied", "null", "null")));
chk("estado desconocido → rechazo", "ERR:23514", await as("service_role", null,
  `update public.ad_attribution set ads_consent = 'unknown' where user_id = '${OTHER}'`));
chk("IP de 46 caracteres → rechazo", "ERR:23514", await as("service_role", null,
  `update public.ad_attribution set ads_consent = 'granted', client_ip = '${"1".repeat(46)}' where user_id = '${OTHER}'`));
chk("usuario inexistente → rechazo (FK)", "ERR:23503", await as("service_role", null, ins("66666666-6666-4666-8666-666666666666", "denied", "null", "null")));
chk("authenticated NO lee ni su propia fila", "ERR:42501", await as("authenticated", SELLER, "select * from public.ad_attribution"));
chk("authenticated NO inserta", "ERR:42501", await as("authenticated", OTHER, ins(OTHER, "granted", "null", "null")));
chk("anon NO lee", "ERR:42501", await as("anon", null, "select * from public.ad_attribution"));
chk("RLS activa", "true", String((await one("select relrowsecurity as r from pg_class where relname = 'ad_attribution'")).r));
chk("sin políticas", "0", String((await one("select count(*)::int as n from pg_policies where tablename = 'ad_attribution'")).n));
chk("borrar el usuario borra su fila", "0", await (async () => {
  await db.exec(`delete from auth.users where id = '${OTHER}'`);
  return String((await one(`select count(*)::int as n from public.ad_attribution where user_id = '${OTHER}'`)).n);
})());

await db.exec(sql(ROLLBACK));
chk("rollback: la tabla ya no existe", "null", String((await one("select to_regclass('public.ad_attribution') as t")).t));
await db.exec(sql(MIG));
chk("re-aplicación tras el rollback", "ad_attribution", String((await one("select to_regclass('public.ad_attribution')::text as t")).t));

console.table(cases);
const fallas = cases.filter((c) => c.ok !== "ok").length;
console.log(fallas === 0 ? `\nad-attribution: ${cases.length} casos OK` : `\n${fallas} FALLA(S)`);
process.exit(fallas === 0 ? 0 : 1);
