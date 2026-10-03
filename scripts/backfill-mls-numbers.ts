// Carga properties.mls_number de listings existentes desde un CSV (dry-run por defecto).
//
// Uso:
//   pnpm mls:backfill-numbers -- numeros.csv                 # dry-run: solo lee e informa
//   pnpm mls:backfill-numbers -- numeros.csv --apply         # escribe
//   pnpm mls:backfill-numbers -- numeros.csv --apply --overwrite   # además reemplaza números ya puestos
//
// CSV (cabecera exacta, sin comillas):
//   property_id,mls_number
//   2b1c…-…,A11234567
//
// SEGURO POR DEFECTO: sin --apply no escribe nada. Todo o nada: con un solo error de
// formato o un bloqueo (propiedad inexistente, número de otra propiedad, número ya
// distinto sin --overwrite) no se aplica ninguna fila.
//
// El número lo teclea la broker desde Matrix. Este script NO lee mls_listings.
// Toda la lógica vive en src/lib/mls-number-backfill.ts (probada); aquí solo se cablea.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createService } from "@/lib/supabase/service";
import {
  parseBackfillArgs,
  parseBackfillCsv,
  planBackfill,
  type BackfillDbState,
} from "@/lib/mls-number-backfill";
import { ENTER_MLS_NUMBER_TASK } from "@/lib/listing-mls-number";

// Cargador mínimo de .env.local (igual que scripts/archive-source-retention.ts).
try {
  const envText = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
} catch {
  /* el entorno puede venir ya del shell */
}

async function main(): Promise<void> {
  const parsed = parseBackfillArgs(process.argv.slice(2).filter((a) => a !== "--"));
  if (!parsed.ok) {
    console.error(`mls:backfill-numbers — ${parsed.error}`);
    process.exitCode = 1;
    return;
  }
  const { file, apply, overwrite } = parsed.args;

  const { rows, issues } = parseBackfillCsv(readFileSync(resolve(process.cwd(), file), "utf8"));
  if (issues.length > 0) {
    console.error(`CSV inválido — no se aplica nada:`);
    for (const i of issues) console.error(`  línea ${i.line}: ${i.message}`);
    process.exitCode = 1;
    return;
  }
  if (rows.length === 0) {
    console.log("El CSV no tiene filas.");
    return;
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY.");
    process.exitCode = 1;
    return;
  }
  const db = createService();

  const ids = rows.map((r) => r.propertyId);
  const numeros = rows.map((r) => r.mlsNumber);
  const [props, dueños] = await Promise.all([
    db.from("properties").select("id,mls_number").in("id", ids),
    db.from("properties").select("id,mls_number").in("mls_number", numeros),
  ]);
  if (props.error || dueños.error) {
    console.error(`No se pudo leer properties: ${(props.error ?? dueños.error)?.message}`);
    process.exitCode = 1;
    return;
  }
  const estado: BackfillDbState = {
    current: new Map((props.data ?? []).map((p) => [p.id as string, (p.mls_number as string | null) ?? null])),
    owners: new Map((dueños.data ?? []).map((p) => [p.mls_number as string, p.id as string])),
  };

  const plan = planBackfill(rows, estado, { overwrite });
  const aPoner = plan.actions.filter((a) => a.kind === "set");
  const iguales = plan.actions.filter((a) => a.kind === "unchanged");

  console.log(`${apply ? "APPLY" : "DRY-RUN"} — ${rows.length} filas: ${aPoner.length} a escribir, ` +
              `${iguales.length} sin cambios, ${plan.blockers.length} bloqueadas.`);
  for (const a of aPoner) {
    if (a.kind !== "set") continue;
    console.log(`  línea ${a.row.line}: ${a.row.propertyId} ${a.previous ?? "(vacío)"} → ${a.row.mlsNumber}`);
  }
  for (const b of plan.blockers) console.error(`  BLOQUEADA línea ${b.line}: ${b.message}`);

  if (plan.blockers.length > 0) {
    console.error("Hay filas bloqueadas — no se aplica nada.");
    process.exitCode = 1;
    return;
  }
  if (!apply) {
    console.log("Dry-run: no se escribió nada. Repite con --apply para aplicar.");
    return;
  }

  let escritas = 0;
  for (const a of aPoner) {
    if (a.kind !== "set") continue;
    const { error } = await db.from("properties").update({ mls_number: a.row.mlsNumber }).eq("id", a.row.propertyId);
    if (error) {
      console.error(`  FALLÓ línea ${a.row.line}: ${error.message} — se detiene aquí (${escritas} escritas).`);
      process.exitCode = 1;
      return;
    }
    await db.from("broker_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("property_id", a.row.propertyId)
      .eq("task_type", ENTER_MLS_NUMBER_TASK)
      .in("status", ["pending", "in_progress"]);
    escritas += 1;
  }
  console.log(`Aplicado: ${escritas} propiedades actualizadas.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
