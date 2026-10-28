// Verifica 20261029120000_buyer_nbr_notice (aviso NBR, F.S. 475.278(4)) contra un Postgres en
// memoria (PGlite): sin Docker y NUNCA contra producción. Réplica mínima (roles, auth.users /
// auth.uid(), has_role / is_admin_or_broker, properties, agent_partners) → las migraciones de
// buyer_leads y schedule_requests → esta migración (dos veces: idempotente) → casos → reversión
// → re-aplicación. Sale con código 1 si alguno no coincide.
//   pnpm db-check:nbr-notice
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const ROOT = resolve(import.meta.dirname, "../..");
const M = join(ROOT, "supabase/migrations") + "/";
const db = new PGlite();
const run = async (label, sql) => { try { await db.exec(sql); console.log("ok  ", label); } catch (e) { console.log("FAIL", label, "→", e.message); throw e; } };
const expectErr = async (label, sql, re) => {
  try { await db.exec(sql); console.log("FAIL", label, "→ no error"); process.exitCode = 1; }
  catch (e) { const ok = re.test(e.message); console.log(ok ? "ok  " : "FAIL", label, "→", e.message.slice(0, 110)); if (!ok) process.exitCode = 1; }
};
await run("stubs", `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''app.uid'', true), '''')::uuid';
  create table public.properties (id uuid primary key default gen_random_uuid());
  create table public.agent_partners (id uuid primary key default gen_random_uuid(), name text, email text, phone text,
    license_number text, status text default 'active');
  create function public.has_role(_role text) returns boolean language sql as 'select current_setting(''app.staff'', true) = ''on''';
  create function public.is_admin_or_broker() returns boolean language sql as 'select current_setting(''app.staff'', true) = ''on''';
`);
for (const f of ["20260520161130_create_schedule_requests.sql", "20260521230654_add_buyer_leads.sql",
                 "20261011150000_buyer_leads_showing_requests.sql", "20261011160000"]) {
  const name = f.endsWith(".sql") ? f : readdirSync(M).find((x) => x.startsWith(f));
  await run(name, readFileSync(M + name, "utf8"));
}
const nbr = readFileSync(M + "20261029120000_buyer_nbr_notice.sql", "utf8");
await run("NBR migration", nbr);
await run("NBR migration again (idempotent)", nbr);

// Leads: sin agente (none) y con agente (exclusive), en un listado propio, con acuerdo registrado.
await run("seed", `
  insert into public.properties (id) values ('00000000-0000-0000-0000-0000000000a1');
  insert into public.buyer_leads (id, source, status, full_name, email, other_agent_status, consent_contact_at, property_id,
     agreement_type, agreement_recorded_at, agreement_exception_code)
  values ('00000000-0000-0000-0000-000000000001', 'showing_request', 'showing_coordinating', 'TEST', 'b@example.com', 'none', now(),
     '00000000-0000-0000-0000-0000000000a1', 'not_required', now(), 'unrepresented_buyer_own_listing'),
         ('00000000-0000-0000-0000-000000000002', 'showing_request', 'showing_coordinating', 'TEST2', 'c@example.com', 'exclusive', now(),
     '00000000-0000-0000-0000-0000000000a1', 'not_required', now(), 'represented_buyer_own_listing');
`);
const L1 = "'00000000-0000-0000-0000-000000000001'", L2 = "'00000000-0000-0000-0000-000000000002'";
await expectErr("sin aviso → no confirma", `update public.buyer_leads set status='showing_confirmed' where id=${L1}`, /nbr_notice_missing/);
await run("aviso aceptado sin verificar", `insert into public.buyer_nbr_notices (lead_id, notice_version, accepted_at, esign_consent_at, esign_version,
  full_name, email, lang, ip, user_agent, notice_text_sha256, verify_token_hash)
  values (${L1}, 'v', now(), now(), 'e', 'TEST', 'b@example.com', 'es', '1.1.1.1', 'UA', 'h', 'vh')`);
await expectErr("aceptado sin verificar → no confirma", `update public.buyer_leads set status='showing_confirmed' where id=${L1}`, /nbr_email_unverified/);
await expectErr("evidencia sin E-SIGN → rechazada", `insert into public.buyer_nbr_notices (lead_id, notice_version, accepted_at, full_name, email, lang, ip, user_agent, notice_text_sha256)
  values (${L1}, 'v', now(), 'T', 'b@example.com', 'es', '1', 'UA', 'h')`, /accepted_evidence/);
await run("verificar correo", `update public.buyer_nbr_notices set email_verified_at = now(), verify_token_hash = null where lead_id=${L1}`);
await run("verificado → confirma", `update public.buyer_leads set status='showing_confirmed' where id=${L1}`);
await expectErr("evidencia aceptada no cambia", `update public.buyer_nbr_notices set full_name='X' where lead_id=${L1}`, /cannot be changed/);
await expectErr("verificación no se reescribe", `update public.buyer_nbr_notices set email_verified_at = now() + interval '1 day' where lead_id=${L1}`, /cannot be changed/);
await expectErr("evidencia aceptada no se borra", `delete from public.buyer_nbr_notices where lead_id=${L1}`, /cannot be deleted/);
await run("PDF enviado se puede anotar", `update public.buyer_nbr_notices set pdf_emailed_at = now() where lead_id=${L1}`);
await expectErr("con agente sin datos → no confirma", `update public.buyer_leads set status='showing_confirmed' where id=${L2}`, /nbr_buyer_agent_missing/);
await run("con agente y sus datos → confirma (motivo represented_buyer_own_listing)", `update public.buyer_leads set buyer_agent_name='Ana', buyer_agent_email='a@example.com' where id=${L2};
  update public.buyer_leads set status='showing_confirmed' where id=${L2}`);

// Loui (schedule_requests)
await run("seed loui", `insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000u1');`.replace("u1","b1") +
  `insert into public.schedule_requests (id, user_id, request_type, topic, status, buyer_agent_status)
   values ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000b1', 'showing', 'TEST', 'pending', 'unsure');`);
await run("grants", `grant usage on schema public to authenticated; grant all on public.schedule_requests to authenticated;`);
await expectErr("comprador (authenticated) no programa su visita", `set app.uid = '00000000-0000-0000-0000-0000000000b1'; set role authenticated; update public.schedule_requests set status='scheduled' where id='00000000-0000-0000-0000-000000000009'`, /Only staff/);
await run("reset role", "reset role; reset app.uid;");
await run("el comprador sí puede cancelar la suya", `set app.uid = '00000000-0000-0000-0000-0000000000b1'; set role authenticated; update public.schedule_requests set status='cancelled' where id='00000000-0000-0000-0000-000000000009'; reset role; reset app.uid; update public.schedule_requests set status='pending' where id='00000000-0000-0000-0000-000000000009';`);
await expectErr("staff sin aviso → no programa", `update public.schedule_requests set status='scheduled' where id='00000000-0000-0000-0000-000000000009'`, /nbr_notice_missing/);
await run("aviso por enlace (aceptado y verificado)", `insert into public.buyer_nbr_notices (schedule_request_id, notice_version, accepted_at, esign_consent_at, esign_version,
  full_name, email, lang, ip, user_agent, notice_text_sha256, email_verified_at)
  values ('00000000-0000-0000-0000-000000000009', 'v', now(), now(), 'e', 'T', 'b@example.com', 'en', '1', 'UA', 'h', now())`);
await run("staff con aviso → programa", `update public.schedule_requests set status='scheduled' where id='00000000-0000-0000-0000-000000000009'`);
await expectErr("un aviso con dos sujetos → rechazado", `insert into public.buyer_nbr_notices (lead_id, schedule_request_id, notice_version) values (${L1}, '00000000-0000-0000-0000-000000000009', 'v')`, /one_subject/);

// Reversión y re-aplicación (con la evidencia borrada antes, como pide el rollback).
await run("vaciar evidencia (el rollback la borra)", `alter table public.buyer_nbr_notices disable trigger guard_buyer_nbr_notices;
  delete from public.buyer_nbr_notices; update public.buyer_leads set agreement_exception_code = 'unrepresented_buyer_own_listing' where id = ${L2};`);
await run("rollback", readFileSync(join(ROOT, "scripts/sql/rollback_20261029120000_buyer_nbr_notice.sql"), "utf8"));
const left = await db.query(`select count(*)::int n from information_schema.columns where table_name in ('buyer_leads','schedule_requests') and column_name like 'buyer_agent_%'`);
console.log(left.rows[0].n === 0 ? "ok  " : "FAIL", "rollback quita las columnas", left.rows[0].n);
if (left.rows[0].n !== 0) process.exitCode = 1;
await run("re-aplicar después del rollback", nbr);
console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
