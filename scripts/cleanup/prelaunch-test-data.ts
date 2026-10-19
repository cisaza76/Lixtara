// Limpieza de datos de prueba antes del lanzamiento.
//
//   pnpm cleanup:test-data                  → SOLO LECTURA: lista lo que se borraría
//   pnpm cleanup:test-data --out plan.json  → además guarda la lista en un archivo local
//   pnpm cleanup:test-data --apply          → pide la frase de confirmación y borra
//
// Qué entra:
//   - listings con properties.is_test = true;
//   - cuentas cuyo correo tiene "+lxtest", "+smtptest" o "qa" (src/lib/cleanup/test-data.ts),
//     con sus listings;
//   - una cuenta de prueba que es dueña de un listing NO marcado is_test no se toca: sale en
//     "para revisar".
// Orden: filas que dependen sin cascada (PROPERTY_DEPENDENTS / USER_DEPENDENTS), fotos del
// bucket property-photos, el listing, y al final la cuenta (Auth; public.users y user_roles
// caen en cascada). Lo que está fuera de la base (Stripe, DocuSign, Resend, Instantly) no se
// toca.
//
// Usa SUPABASE_SECRET_KEY de .env.local. La salida tiene correos: no la pegues en tickets ni
// la subas al repo.
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  PROPERTY_DEPENDENTS,
  USER_DEPENDENTS,
  buildCleanupPlan,
  confirmationPhrase,
  type CleanupAccount,
  type CleanupProperty,
} from "@/lib/cleanup/test-data";

const APPLY = process.argv.includes("--apply");
const outIdx = process.argv.indexOf("--out");
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : null;
const PHOTO_BUCKET = "property-photos";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY (cargar .env.local).");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

async function allAccounts(): Promise<CleanupAccount[]> {
  const out: CleanupAccount[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    out.push(...data.users.map((u) => ({ id: u.id, email: u.email ?? null })));
    if (data.users.length < 1000) return out;
  }
}

async function allProperties(): Promise<Array<CleanupProperty & { address: string; mls_status: string }>> {
  const out: Array<CleanupProperty & { address: string; mls_status: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("properties")
      .select("id,owner_id,is_test,address_street,address_city,mls_status")
      .range(from, from + 999);
    if (error) throw new Error(`properties: ${error.message}`);
    for (const p of data ?? []) {
      out.push({
        id: p.id,
        owner_id: p.owner_id,
        is_test: p.is_test === true,
        address: [p.address_street, p.address_city].filter(Boolean).join(", "),
        mls_status: p.mls_status,
      });
    }
    if ((data ?? []).length < 1000) return out;
  }
}

async function countIn(table: string, column: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).in(column, ids.slice(i, i + 200));
    if (error) throw new Error(`${table}.${column}: ${error.message}`);
    total += count ?? 0;
  }
  return total;
}

async function photoPaths(p: CleanupProperty): Promise<string[]> {
  if (!p.owner_id) return [];
  const dir = `${p.owner_id}/${p.id}`;
  const { data, error } = await db.storage.from(PHOTO_BUCKET).list(dir, { limit: 1000 });
  if (error) return [];
  return (data ?? []).map((o) => `${dir}/${o.name}`);
}

async function main() {
  const [accounts, properties] = await Promise.all([allAccounts(), allProperties()]);
  const plan = buildCleanupPlan(accounts, properties);
  const propIds = plan.properties.map((p) => p.id);
  const userIds = plan.accounts.map((a) => a.id);
  const byId = new Map(properties.map((p) => [p.id, p]));

  console.log(`\n${APPLY ? "MODO BORRADO" : "SOLO LECTURA (no se borra nada)"} · ${url}\n`);
  console.log(`Listings a borrar: ${plan.properties.length}`);
  for (const p of plan.properties) {
    const full = byId.get(p.id)!;
    console.log(`  ${p.id}  ${full.mls_status.padEnd(16)} is_test=${p.is_test}  ${full.address}`);
  }
  console.log(`\nCuentas a borrar: ${plan.accounts.length}`);
  for (const a of plan.accounts) console.log(`  ${a.id}  ${a.email}`);
  if (plan.accountsToReview.length > 0) {
    console.log(`\nPara revisar (correo de prueba con listings NO marcados is_test; no se tocan): ${plan.accountsToReview.length}`);
    for (const a of plan.accountsToReview) console.log(`  ${a.id}  ${a.email}  listings: ${a.realPropertyIds.join(", ")}`);
  }

  console.log("\nFilas que dependen y se borran antes:");
  const deps: Record<string, number> = {};
  for (const d of PROPERTY_DEPENDENTS) deps[`${d.table}.${d.column}`] = await countIn(d.table, d.column, propIds);
  for (const d of USER_DEPENDENTS) {
    const k = `${d.table}.${d.column}`;
    deps[k] = (deps[k] ?? 0) + (await countIn(d.table, d.column, userIds));
  }
  for (const [k, n] of Object.entries(deps)) if (n > 0) console.log(`  ${k}: ${n}`);
  const photos = (await Promise.all(plan.properties.map(photoPaths))).flat();
  console.log(`  ${PHOTO_BUCKET} (archivos): ${photos.length}`);

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), plan, dependents: deps, photos: photos.length }, null, 2));
    console.log(`\nLista guardada en ${OUT} (tiene correos: no la subas al repo).`);
  }

  if (!APPLY) {
    console.log("\nNada se borró. Para borrar: pnpm cleanup:test-data --apply");
    return;
  }
  if (plan.properties.length === 0 && plan.accounts.length === 0) {
    console.log("\nNo hay nada que borrar.");
    return;
  }

  const phrase = confirmationPhrase(plan);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`\nPara borrar, escribe exactamente: ${phrase}\n> `)).trim();
  rl.close();
  if (answer !== phrase) {
    console.log("No coincide. Nada se borró.");
    return;
  }

  const failures: string[] = [];
  const del = async (label: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error) failures.push(`${label}: ${error.message}`);
  };

  for (const p of plan.properties) {
    for (const d of PROPERTY_DEPENDENTS) await del(`${d.table} ${p.id}`, () => db.from(d.table).delete().eq(d.column, p.id));
    const paths = await photoPaths(p);
    if (paths.length > 0) await del(`fotos ${p.id}`, () => db.storage.from(PHOTO_BUCKET).remove(paths));
    await del(`listing ${p.id}`, () => db.from("properties").delete().eq("id", p.id));
  }
  for (const a of plan.accounts) {
    for (const d of USER_DEPENDENTS) await del(`${d.table} ${a.id}`, () => db.from(d.table).delete().eq(d.column, a.id));
    await del(`cuenta ${a.id}`, () => db.auth.admin.deleteUser(a.id));
  }

  const [leftProps, leftAccounts] = await Promise.all([allProperties(), allAccounts()]);
  const remaining = buildCleanupPlan(leftAccounts, leftProps);
  console.log(`\nBorrado terminado. Quedan: ${remaining.properties.length} listings y ${remaining.accounts.length} cuentas de prueba.`);
  if (failures.length > 0) {
    console.log(`Errores (${failures.length}):`);
    for (const f of failures) console.log(`  ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
