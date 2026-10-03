import { describe, it, expect } from "vitest";
import { parseBackfillArgs, parseBackfillCsv, planBackfill, type BackfillDbState } from "./mls-number-backfill";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";
const csv = (...filas: string[]) => ["property_id,mls_number", ...filas].join("\n");

describe("parseBackfillCsv", () => {
  it("parsea, normaliza y numera las líneas", () => {
    const r = parseBackfillCsv(csv(`${P1},a11234567`, "", `${P2.toUpperCase()}, F10123456 `));
    expect(r.issues).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, propertyId: P1, mlsNumber: "A11234567" },
      { line: 4, propertyId: P2, mlsNumber: "F10123456" },
    ]);
  });

  it("acepta BOM y CRLF", () => {
    expect(parseBackfillCsv(`﻿property_id,mls_number\r\n${P1},A11234567\r\n`).rows).toHaveLength(1);
  });

  it("exige la cabecera exacta", () => {
    expect(parseBackfillCsv(`id,mls\n${P1},A11234567`).issues[0].message).toContain("cabecera");
  });

  it("todo o nada: un error anula todas las filas", () => {
    const r = parseBackfillCsv(csv(`${P1},A11234567`, `${P2},NOPE`));
    expect(r.rows).toEqual([]);
    expect(r.issues).toEqual([{ line: 3, message: 'mls_number con formato inválido: "NOPE"' }]);
  });

  it("detecta UUID inválido, columnas de más, comillas, vacíos y repetidos", () => {
    const r = parseBackfillCsv(csv(
      "no-es-uuid,A11234567",
      `${P1},A11234567,extra`,
      `"${P1}",A11234567`,
      `${P1},`,
      `${P2},A11234567`,
      `${P2},F10123456`,
      `${P3},A11234567`,
    ));
    expect(r.issues.map((i) => i.line)).toEqual([2, 3, 4, 5, 7, 8]);
    expect(r.issues[4].message).toContain("property_id repetido");
    expect(r.issues[5].message).toContain("mls_number repetido");
  });
});

describe("planBackfill", () => {
  const filas = parseBackfillCsv(csv(`${P1},A11234567`, `${P2},F10123456`)).rows;
  const db = (over: Partial<BackfillDbState> = {}): BackfillDbState => ({
    current: new Map([[P1, null], [P2, null]]),
    owners: new Map(),
    ...over,
  });

  it("escribe lo vacío", () => {
    const p = planBackfill(filas, db());
    expect(p.blockers).toEqual([]);
    expect(p.actions.map((a) => a.kind)).toEqual(["set", "set"]);
  });

  it("no reescribe lo que ya coincide", () => {
    const p = planBackfill(filas, db({ current: new Map([[P1, "A11234567"], [P2, null]]),
                                       owners: new Map([["A11234567", P1]]) }));
    expect(p.actions.map((a) => a.kind)).toEqual(["unchanged", "set"]);
  });

  it("bloquea una propiedad inexistente", () => {
    const p = planBackfill(filas, db({ current: new Map([[P1, null]]) }));
    expect(p.blockers).toEqual([{ line: 3, message: `la propiedad ${P2} no existe` }]);
  });

  it("bloquea un número que ya tiene OTRA propiedad", () => {
    const p = planBackfill(filas, db({ owners: new Map([["F10123456", P3]]) }));
    expect(p.blockers[0].message).toContain(`ya pertenece a la propiedad ${P3}`);
  });

  it("no pisa un número distinto sin --overwrite; con él, sí", () => {
    const estado = db({ current: new Map([[P1, "A99999999"], [P2, null]]) });
    expect(planBackfill(filas, estado).blockers[0].message).toContain("--overwrite");
    const p = planBackfill(filas, estado, { overwrite: true });
    expect(p.blockers).toEqual([]);
    expect(p.actions[0]).toMatchObject({ kind: "set", previous: "A99999999" });
  });
});

describe("parseBackfillArgs", () => {
  it("dry-run por defecto", () => {
    expect(parseBackfillArgs(["x.csv"])).toEqual({ ok: true, args: { file: "x.csv", apply: false, overwrite: false } });
  });
  it("--apply y --overwrite explícitos", () => {
    expect(parseBackfillArgs(["x.csv", "--apply", "--overwrite"]))
      .toEqual({ ok: true, args: { file: "x.csv", apply: true, overwrite: true } });
  });
  it("rechaza opciones desconocidas y la falta de archivo", () => {
    expect(parseBackfillArgs(["x.csv", "--force"]).ok).toBe(false);
    expect(parseBackfillArgs([]).ok).toBe(false);
  });
});
