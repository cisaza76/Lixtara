#!/usr/bin/env python3
"""
import_contacts.py — Carga los emails del skip tracing: crm_contacts con su evidencia de identidad,
validación y elegibilidad (historial append-only) y, solo para contactos Clase A elegibles,
crm_owners.email (lo que puede enviarse).

  python import_contacts.py --file ~/lixtara-data/contactos.csv --dry-run  # valida y revierte
  python import_contacts.py --file ~/lixtara-data/contactos.csv            # carga real

CSV (UTF-8, con encabezado):
  owner_key           el hash de lixtara_base.py (columna Owner_Key de los otros CSV)
  email               el email encontrado
  email_source        de dónde salió (proveedor de skip tracing / verificador), obligatorio
  verification_status valid | invalid | risky | unknown   (también se acepta "verification")
  class               A | B | C  (validación de identidad del pipeline local)
  rule                regla que dio la clase
  rules_version       versión de las reglas de identidad
  eligible            true | false
  eligibility_basis   fundamento de la elegibilidad (legal / técnico)
  Opcionales: evidence (JSON), ledger_ref (contact_id del ledger local), verification_method
  (p. ej. smtp:millionverifier), validated_at (ISO 8601).

Requiere:  pip install "psycopg[binary]" pandas
Conexión:  SUPABASE_DB_URL (Project Settings → Database → Connection string, modo
           "Session"). Usa el usuario postgres: ignora RLS. Nunca la pongas en el repo.

Reglas (las aplica scripts/sql/crm_import_contacts.sql, el mismo SQL que prueba
`pnpm db-check:crm`):
- Toda fila con propietario conocido, email bien formado, fuente y evidencia completa queda
  registrada en crm_contacts + historial. Re-ejecutar el mismo CSV no agrega historial.
- Solo Clase A con eligible=true puede llegar a crm_owners.email; el resto queda registrado
  pero no enviable ("recorded_only").
- Solo "valid" marca email_verified_at, es decir, solo "valid" queda enviable.
- "invalid" y "risky" nunca se cargan como enviables; si coinciden con el email actual
  verificado, lo desmarcan.
- "unknown" carga el email sin verificar, salvo que ya haya uno verificado.
- Nunca sobrescribe un email que esté en crm_suppression ni carga uno suprimido.
- Una sola transacción: si algo falla, no queda nada a medias. --dry-run revierte todo.
- El CSV tiene datos personales: se lee desde tu carpeta local y no entra al repo.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import pandas as pd
import psycopg

SQL_FILE = Path(__file__).resolve().parent / "sql" / "crm_import_contacts.sql"

SQL_STAGE = """
create temp table stg_contacts (
  row_no int, owner_key text, email text, email_source text, verification text,
  class text, rule text, rules_version text, evidence text, ledger_ref text,
  eligible text, eligibility_basis text, verification_method text, validated_at text
) on commit drop;
"""
REQUIRED = ["owner_key", "email", "email_source", "verification_status", "class", "rule", "rules_version",
            "eligible", "eligibility_basis"]
OPTIONAL = ["evidence", "ledger_ref", "verification_method", "validated_at"]
COPY_COLS = ("row_no, owner_key, email, email_source, verification, class, rule, rules_version, evidence, "
             "ledger_ref, eligible, eligibility_basis, verification_method, validated_at")
SQL_HISTORY = """
select (select count(*) from stg_contacts_rec) as registrados,
       (select count(distinct contact_id) from stg_contacts_rec) as contactos
"""

SQL_SUMMARY = "select outcome, count(*) from stg_contacts_eval group by outcome order by outcome;"

# Qué significa cada resultado, para el resumen.
OUTCOMES = {
    "loaded_valid": "cargados y verificados (enviables)",
    "reverified": "mismo email, verificación renovada",
    "loaded_unverified": "cargados SIN verificar (no enviables)",
    "unchanged_unverified": "mismo email sin verificar, sin cambios",
    "demoted": "email actual desmarcado (ahora invalid/risky)",
    "rejected_invalid": "invalid: no se cargan",
    "rejected_risky": "risky: no se cargan",
    "kept_verified": "unknown ignorado: ya tenía un email verificado",
    "kept_suppressed_current": "omitidos: el email actual está suprimido",
    "skipped_suppressed_new": "omitidos: el email nuevo está suprimido",
    "skipped_email_taken": "omitidos: el email ya es de otro propietario",
    "duplicate_owner_in_file": "omitidos: owner_key repetido en el CSV",
    "duplicate_email_in_file": "omitidos: email repetido en el CSV",
    "unknown_owner": "omitidos: owner_key que no está en crm_owners",
    "missing_source": "omitidos: falta email_source",
    "bad_email": "omitidos: email vacío o mal formado",
    "bad_status": "omitidos: estado de verificación desconocido",
    "missing_evidence": "omitidos: falta clase, regla, versión o elegibilidad",
    "recorded_only": "registrados con su evidencia, NO enviables (no son Clase A elegible)",
}


def read_rows(path: Path) -> list[tuple]:
    df = pd.read_csv(path, dtype=str, encoding="utf-8-sig").fillna("")
    df.columns = [c.strip().lower() for c in df.columns]
    if "verification_status" not in df.columns and "verification" in df.columns:
        df = df.rename(columns={"verification": "verification_status"})
    missing = set(REQUIRED) - set(df.columns)
    if missing:
        sys.exit(f"ERROR: faltan columnas en {path.name}: {', '.join(sorted(missing))}")
    for c in OPTIONAL:
        if c not in df.columns:
            df[c] = ""
    return [
        (i + 2, r["owner_key"], r["email"], r["email_source"], r["verification_status"], r["class"], r["rule"],
         r["rules_version"], r["evidence"], r["ledger_ref"], r["eligible"], r["eligibility_basis"],
         r["verification_method"], r["validated_at"])  # fila 1 = encabezado
        for i, r in enumerate(df.to_dict("records"))
    ]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", required=True, help="CSV de contactos del skip tracing")
    ap.add_argument("--dry-run", action="store_true", help="Valida y revierte sin guardar")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("ERROR: define SUPABASE_DB_URL (cadena de conexión de Supabase).")

    path = Path(args.file).expanduser()
    if not path.exists():
        sys.exit(f"ERROR: no encuentro {path}")
    rows = read_rows(path)
    if not rows:
        sys.exit(f"ERROR: {path.name} no tiene filas.")

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(SQL_STAGE)
            with cur.copy(f"copy stg_contacts ({COPY_COLS}) from stdin") as cp:
                for r in rows:
                    cp.write_row(r)
            cur.execute(SQL_FILE.read_text(encoding="utf-8"))
            summary = cur.execute(SQL_SUMMARY).fetchall()
            recorded, contacts = cur.execute(SQL_HISTORY).fetchone()
            sendable = cur.execute(
                "select count(*) from public.crm_sendable_email_owners"
            ).fetchone()[0]

        print(f"Filas leídas: {len(rows):,}")
        for outcome, count in summary:
            print(f"  {count:>7,}  {OUTCOMES.get(outcome, outcome)}")
        print(f"Filas registradas en el historial: {recorded:,} ({contacts:,} contactos)")
        print(f"Propietarios enviables tras la carga: {sendable:,}")
        if args.dry_run:
            conn.rollback()
            print("DRY RUN: nada se guardó.")
        else:
            conn.commit()
            print("Listo: guardado en Supabase.")


if __name__ == "__main__":
    main()
