#!/usr/bin/env python3
"""
import_crm_leads.py — Carga las salidas de lixtara_base.py en las tablas crm_* de Supabase.

  python import_crm_leads.py --dir ~/lixtara-data/salida            # carga real
  python import_crm_leads.py --dir ~/lixtara-data/salida --dry-run  # valida y revierte

Requiere:  pip install "psycopg[binary]" pandas
Conexión:  variable de entorno SUPABASE_DB_URL (Project Settings → Database → Connection
           string, modo "Session"). Usa el usuario postgres: ignora RLS. Nunca la pongas
           en el repo ni en el frontend.

Reglas:
- Upsert por owner_key (propietarios) y por (county, folio) (propiedades): recargar
  actualiza, no duplica.
- NUNCA pisa email, teléfono, DNC, estado de outreach ni supresión: esos datos vienen
  del skip tracing y de las campañas, no del roll.
- Todo corre en una sola transacción: si algo falla, no queda nada a medias.
- Los CSV con datos personales se leen desde tu carpeta local; no entran al repo.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import pandas as pd
import psycopg

SIGNALS = ["lis_pendens", "probate", "impuestos_morosos", "mls_expirado", "codigo"]

OWNER_COLS = [
    "owner_key", "owner_type", "registered_name", "mail_line1", "mail_line2", "mail_city",
    "mail_state_country", "mail_zip", "domicile", "is_absentee", "is_foreign",
    "is_out_of_state", "num_properties", "portfolio_value", "score", "has_strong_signal",
    "priority", "pilot_group", "sunbiz_match", "sunbiz_doc", "sunbiz_status",
    "sunbiz_filing_type", "sunbiz_formed_on", "sunbiz_registered_agent", "sunbiz_managers",
    "source", "collected_on",
]
PROP_COLS = [
    "county", "folio", "address", "unit", "city", "zip", "use_code", "property_type",
    "just_value", "year_built", "living_area_sqft", "units", "recent_sale_year",
    "recent_sale_price", "is_recent_purchase", "score", "has_strong_signal", "priority",
    "mls_status", "source", "collected_on", "owner_key", "signals",
]


def read(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path, dtype=str, encoding="utf-8-sig").fillna("")


def s(v):
    v = str(v).strip()
    return v or None


def b(v) -> bool:
    return str(v).strip().lower() in ("sí", "si", "true", "1", "yes")


def n(v, as_int=False):
    v = str(v).strip().replace(",", "")
    if not v:
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return int(round(f)) if as_int else f


def owners_rows(df: pd.DataFrame, pilot: dict[str, str]) -> list[tuple]:
    rows = []
    for r in df.to_dict("records"):
        managers = [m for m in (r.get("Sunbiz_Manager_1", ""), r.get("Sunbiz_Manager_2", ""),
                                r.get("Sunbiz_Manager_3", "")) if m]
        rows.append((
            r["Owner_Key"], r["Tipo_Propietario"], r["Nombre_Registro"],
            s(r.get("Postal_Linea1", "")), s(r.get("Postal_Linea2", "")),
            s(r.get("Postal_Ciudad", "")), s(r.get("Postal_Estado_Pais", "")),
            s(r.get("Postal_ZIP", "")), s(r.get("Domicilio", "")),
            b(r.get("Ausente")), b(r.get("Extranjero")), b(r.get("Fuera_de_Estado")),
            n(r.get("Num_Propiedades"), True) or 0, n(r.get("Valor_Total_Cartera")),
            n(r.get("Score_Max"), True), b(r.get("Senal_Fuerte")), s(r.get("Prioridad", "")),
            pilot.get(r["Owner_Key"]),
            s(r.get("Sunbiz_Match", "")), s(r.get("Sunbiz_Documento", "")),
            s(r.get("Sunbiz_Estatus", "")), s(r.get("Sunbiz_Tipo", "")),
            s(r.get("Sunbiz_Fecha_Constitucion", "")), s(r.get("Sunbiz_Agente_Registrado", "")),
            managers or None,
            r["Fuente"], r["Fecha_Recoleccion"],
        ))
    return rows


def property_rows(df: pd.DataFrame) -> list[tuple]:
    rows = []
    for r in df.to_dict("records"):
        sigs = [sg for sg in SIGNALS if b(r.get(f"Senal_{sg}", ""))]
        rows.append((
            r["Condado"], r["Folio"], s(r.get("Direccion", "")), s(r.get("Unidad", "")),
            s(r.get("Ciudad", "")), s(r.get("ZIP", "")), s(r.get("Uso_DOR", "")),
            s(r.get("Tipo_Propiedad", "")), n(r.get("Valor_Just_Value")),
            n(r.get("Anio_Construccion"), True), n(r.get("Area_Habitable_sqft"), True),
            n(r.get("Unidades"), True), n(r.get("Anio_Venta_Reciente"), True),
            n(r.get("Precio_Venta_Reciente")), b(r.get("Compra_Reciente")),
            n(r.get("Score"), True), b(r.get("Senal_Fuerte")), s(r.get("Prioridad", "")),
            s(r.get("MLS_Status", "")), r["Fuente"], r["Fecha_Recoleccion"],
            r["Owner_Key"], sigs or None,
        ))
    return rows


SQL_STAGE = """
create temp table stg_owners (
  owner_key text, owner_type text, registered_name text, mail_line1 text, mail_line2 text,
  mail_city text, mail_state_country text, mail_zip text, domicile text,
  is_absentee boolean, is_foreign boolean, is_out_of_state boolean, num_properties int,
  portfolio_value numeric, score int, has_strong_signal boolean, priority text,
  pilot_group text, sunbiz_match text, sunbiz_doc text, sunbiz_status text,
  sunbiz_filing_type text, sunbiz_formed_on date, sunbiz_registered_agent text,
  sunbiz_managers text[], source text, collected_on date
) on commit drop;
create temp table stg_props (
  county text, folio text, address text, unit text, city text, zip text, use_code text,
  property_type text, just_value numeric, year_built int, living_area_sqft int, units int,
  recent_sale_year int, recent_sale_price numeric, is_recent_purchase boolean, score int,
  has_strong_signal boolean, priority text, mls_status text, source text, collected_on date,
  owner_key text, signals text[]
) on commit drop;
"""

SQL_UPSERT = """
with up as (
  insert into public.crm_owners as o (
    owner_key, owner_type, registered_name, mail_line1, mail_line2, mail_city,
    mail_state_country, mail_zip, domicile, is_absentee, is_foreign, is_out_of_state,
    num_properties, portfolio_value, score, has_strong_signal, priority, pilot_group,
    sunbiz_match, sunbiz_doc, sunbiz_status, sunbiz_filing_type, sunbiz_formed_on,
    sunbiz_registered_agent, sunbiz_managers, source, collected_on)
  select * from stg_owners
  on conflict (owner_key) do update set
    owner_type = excluded.owner_type, registered_name = excluded.registered_name,
    mail_line1 = excluded.mail_line1, mail_line2 = excluded.mail_line2,
    mail_city = excluded.mail_city, mail_state_country = excluded.mail_state_country,
    mail_zip = excluded.mail_zip, domicile = excluded.domicile,
    is_absentee = excluded.is_absentee, is_foreign = excluded.is_foreign,
    is_out_of_state = excluded.is_out_of_state, num_properties = excluded.num_properties,
    portfolio_value = excluded.portfolio_value, score = excluded.score,
    has_strong_signal = excluded.has_strong_signal, priority = excluded.priority,
    pilot_group = coalesce(excluded.pilot_group, o.pilot_group),
    sunbiz_match = coalesce(excluded.sunbiz_match, o.sunbiz_match),
    sunbiz_doc = coalesce(excluded.sunbiz_doc, o.sunbiz_doc),
    sunbiz_status = coalesce(excluded.sunbiz_status, o.sunbiz_status),
    sunbiz_filing_type = coalesce(excluded.sunbiz_filing_type, o.sunbiz_filing_type),
    sunbiz_formed_on = coalesce(excluded.sunbiz_formed_on, o.sunbiz_formed_on),
    sunbiz_registered_agent = coalesce(excluded.sunbiz_registered_agent, o.sunbiz_registered_agent),
    sunbiz_managers = coalesce(excluded.sunbiz_managers, o.sunbiz_managers),
    source = excluded.source, collected_on = excluded.collected_on
    -- email, phone, dnc_status, outreach_status: NO se tocan
  returning (xmax = 0) as inserted
)
select count(*) filter (where inserted), count(*) filter (where not inserted) from up;
"""

SQL_PROPS = """
with up as (
  insert into public.crm_properties as p (
    county, folio, address, unit, city, zip, use_code, property_type, just_value, year_built,
    living_area_sqft, units, recent_sale_year, recent_sale_price, is_recent_purchase, score,
    has_strong_signal, priority, mls_status, source, collected_on)
  select county, folio, address, unit, city, zip, use_code, property_type, just_value,
         year_built, living_area_sqft, units, recent_sale_year, recent_sale_price,
         is_recent_purchase, score, has_strong_signal, priority, mls_status, source, collected_on
    from stg_props
  on conflict (county, folio) do update set
    address = excluded.address, unit = excluded.unit, city = excluded.city, zip = excluded.zip,
    use_code = excluded.use_code, property_type = excluded.property_type,
    just_value = excluded.just_value, year_built = excluded.year_built,
    living_area_sqft = excluded.living_area_sqft, units = excluded.units,
    recent_sale_year = excluded.recent_sale_year, recent_sale_price = excluded.recent_sale_price,
    is_recent_purchase = excluded.is_recent_purchase, score = excluded.score,
    has_strong_signal = excluded.has_strong_signal, priority = excluded.priority,
    mls_status = excluded.mls_status, source = excluded.source, collected_on = excluded.collected_on
  returning (xmax = 0) as inserted
)
select count(*) filter (where inserted), count(*) filter (where not inserted) from up;
"""

SQL_LINKS = """
insert into public.crm_property_owners (property_id, owner_id, valid_from)
select p.id, o.id, sp.collected_on
  from stg_props sp
  join public.crm_properties p on p.county = sp.county and p.folio = sp.folio
  join public.crm_owners o on o.owner_key = sp.owner_key
on conflict do nothing;
"""

SQL_SIGNALS = """
insert into public.crm_property_signals (property_id, signal, source, observed_on)
select p.id, sig, sp.source || ' + --signal ' || sig, sp.collected_on
  from stg_props sp
  cross join lateral unnest(sp.signals) as sig
  join public.crm_properties p on p.county = sp.county and p.folio = sp.folio
on conflict (property_id, signal) do nothing;
"""

SQL_ORPHANS = """
select count(*) from stg_props sp
 where not exists (select 1 from public.crm_owners o where o.owner_key = sp.owner_key);
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", required=True, help="Carpeta de salida de lixtara_base.py")
    ap.add_argument("--dry-run", action="store_true", help="Valida y revierte sin guardar")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("ERROR: define SUPABASE_DB_URL (cadena de conexión de Supabase).")

    d = Path(args.dir).expanduser()
    people = read(d / "attio_propietarios_personas.csv")
    ents = read(d / "attio_propietarios_entidades.csv")
    props = read(d / "attio_propiedades.csv")
    pilot_df = read(d / "piloto_propietarios.csv")
    if props.empty or (people.empty and ents.empty):
        sys.exit(f"ERROR: no encuentro las salidas de lixtara_base.py en {d}")
    pilot = dict(zip(pilot_df.get("Owner_Key", []), pilot_df.get("Grupo_Piloto", [])))

    owners = pd.concat([people, ents], ignore_index=True).fillna("").drop_duplicates("Owner_Key")
    o_rows, p_rows = owners_rows(owners, pilot), property_rows(props)

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(SQL_STAGE)
            with cur.copy(f"copy stg_owners ({', '.join(OWNER_COLS)}) from stdin") as cp:
                for r in o_rows:
                    cp.write_row(r)
            with cur.copy(f"copy stg_props ({', '.join(PROP_COLS)}) from stdin") as cp:
                for r in p_rows:
                    cp.write_row(r)
            o_new, o_upd = cur.execute(SQL_UPSERT).fetchone()
            p_new, p_upd = cur.execute(SQL_PROPS).fetchone()
            links = cur.execute(SQL_LINKS).rowcount
            sigs = cur.execute(SQL_SIGNALS).rowcount
            orphans = cur.execute(SQL_ORPHANS).fetchone()[0]

        print(f"Propietarios: {o_new:,} nuevos · {o_upd:,} actualizados")
        print(f"Propiedades:  {p_new:,} nuevas · {p_upd:,} actualizadas")
        print(f"Vínculos propiedad↔propietario nuevos: {links:,}")
        print(f"Señales nuevas: {sigs:,}")
        print(f"En piloto: {len(pilot):,}")
        if orphans:
            print(f"ALERTA: {orphans:,} propiedades sin propietario en los CSV (revisar).")
        if args.dry_run:
            conn.rollback()
            print("DRY RUN: nada se guardó.")
        else:
            conn.commit()
            print("Listo: guardado en Supabase.")


if __name__ == "__main__":
    main()
