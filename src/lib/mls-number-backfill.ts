// Carga de `properties.mls_number` para listings que YA existen, desde un CSV que llena la
// broker a mano (property_id, mls_number). Lógica PURA: parseo, validación y plan. El
// script `scripts/backfill-mls-numbers.ts` solo cablea la base de datos.
//
// NADA se cruza contra `mls_listings`: el número viene de Matrix, tecleado por una
// persona — ver src/lib/listing-mls-number.ts sobre § III.B.9.
import { parseMlsNumber } from "@/lib/listing-mls-number";

export interface BackfillRow {
  /** Línea del CSV (1 = cabecera), para que los errores digan dónde mirar. */
  line: number;
  propertyId: string;
  mlsNumber: string;
}

export interface BackfillIssue {
  line: number;
  message: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parsea y valida el CSV. Todo o nada: si hay UN error, no se devuelve ninguna fila, para
 * que un archivo a medio corregir no se aplique a medias.
 *
 * Formato estricto a propósito: cabecera exacta `property_id,mls_number`, dos columnas, sin
 * comillas. Es un archivo pequeño hecho a mano; aceptar variantes solo esconde errores.
 */
export function parseBackfillCsv(text: string): { rows: BackfillRow[]; issues: BackfillIssue[] } {
  const issues: BackfillIssue[] = [];
  const lineas = text.replace(/^﻿/, "").split(/\r?\n/);

  const cabecera = (lineas[0] ?? "").trim().toLowerCase();
  if (cabecera !== "property_id,mls_number") {
    return { rows: [], issues: [{ line: 1, message: "la cabecera debe ser exactamente `property_id,mls_number`" }] };
  }

  const rows: BackfillRow[] = [];
  const porPropiedad = new Map<string, number>();
  const porNumero = new Map<string, number>();

  lineas.slice(1).forEach((raw, i) => {
    const line = i + 2;
    if (raw.trim() === "") return;
    if (raw.includes('"')) { issues.push({ line, message: "no se admiten comillas" }); return; }

    const cols = raw.split(",");
    if (cols.length !== 2) { issues.push({ line, message: `se esperaban 2 columnas, hay ${cols.length}` }); return; }

    const propertyId = cols[0].trim().toLowerCase();
    if (!UUID.test(propertyId)) { issues.push({ line, message: `property_id no es un UUID: "${cols[0].trim()}"` }); return; }

    const mls = parseMlsNumber(cols[1]);
    if (!mls.ok) {
      issues.push({ line, message: mls.reason === "empty"
        ? "mls_number vacío"
        : `mls_number con formato inválido: "${cols[1].trim()}"` });
      return;
    }

    const repP = porPropiedad.get(propertyId);
    if (repP) { issues.push({ line, message: `property_id repetido (ya en la línea ${repP})` }); return; }
    const repN = porNumero.get(mls.value);
    if (repN) { issues.push({ line, message: `mls_number repetido (ya en la línea ${repN})` }); return; }

    porPropiedad.set(propertyId, line);
    porNumero.set(mls.value, line);
    rows.push({ line, propertyId, mlsNumber: mls.value });
  });

  return issues.length > 0 ? { rows: [], issues } : { rows, issues };
}

/** Lo que la base sabe de cada fila del CSV. */
export interface BackfillDbState {
  /** property_id → mls_number actual (null si no tiene). Ausente = no existe. */
  current: Map<string, string | null>;
  /** mls_number → property_id que ya lo tiene, para los números del CSV. */
  owners: Map<string, string>;
}

export type BackfillAction =
  | { kind: "set"; row: BackfillRow; previous: string | null }
  | { kind: "unchanged"; row: BackfillRow };

export interface BackfillPlan {
  actions: BackfillAction[];
  /** Si hay alguno, NO se aplica nada. */
  blockers: BackfillIssue[];
}

/**
 * Decide qué hacer con cada fila. Bloquea (y entonces no se aplica NADA):
 *   - property_id que no existe;
 *   - número que ya tiene OTRA propiedad (violaría el UNIQUE);
 *   - propiedad que ya tiene un número DISTINTO, salvo `overwrite` — corregir un número
 *     es una decisión explícita, no un efecto de volver a correr el script.
 */
export function planBackfill(
  rows: BackfillRow[],
  db: BackfillDbState,
  opts: { overwrite?: boolean } = {},
): BackfillPlan {
  const actions: BackfillAction[] = [];
  const blockers: BackfillIssue[] = [];

  for (const row of rows) {
    if (!db.current.has(row.propertyId)) {
      blockers.push({ line: row.line, message: `la propiedad ${row.propertyId} no existe` });
      continue;
    }
    const actual = db.current.get(row.propertyId) ?? null;
    if (actual === row.mlsNumber) { actions.push({ kind: "unchanged", row }); continue; }

    const dueño = db.owners.get(row.mlsNumber);
    if (dueño && dueño !== row.propertyId) {
      blockers.push({ line: row.line, message: `${row.mlsNumber} ya pertenece a la propiedad ${dueño}` });
      continue;
    }
    if (actual !== null && !opts.overwrite) {
      blockers.push({
        line: row.line,
        message: `la propiedad ya tiene ${actual}; usa --overwrite para reemplazarlo por ${row.mlsNumber}`,
      });
      continue;
    }
    actions.push({ kind: "set", row, previous: actual });
  }
  return { actions, blockers };
}

export interface BackfillArgs {
  file: string;
  apply: boolean;
  overwrite: boolean;
}

export function parseBackfillArgs(argv: string[]): { ok: true; args: BackfillArgs } | { ok: false; error: string } {
  let file: string | null = null;
  let apply = false;
  let overwrite = false;
  for (const a of argv) {
    if (a === "--apply") apply = true;
    else if (a === "--overwrite") overwrite = true;
    else if (a === "--dry-run") apply = false;
    else if (a.startsWith("--")) return { ok: false, error: `opción desconocida: ${a}` };
    else if (file === null) file = a;
    else return { ok: false, error: "solo se admite un archivo CSV" };
  }
  if (!file) return { ok: false, error: "falta la ruta del CSV" };
  return { ok: true, args: { file, apply, overwrite } };
}
