/**
 * Verifica contra el feed REAL los nombres de campo que el código asume.
 *
 * POR QUÉ EXISTE: el diseño da por buenos `CountyOrParish` y `StateOrProvince` porque son
 * el estándar RESO, pero **nadie lo ha confirmado contra Bridge** — su documentación es
 * una SPA que no sirve contenido a un fetch. Este script convierte esa suposición en un
 * hecho, y es el paso que debe correrse ANTES de confiar en el filtro de cobertura.
 *
 *   pnpm tsx scripts/inspect-bridge-fields.ts
 *
 * Requiere MLS_BRIDGE_SERVER_TOKEN y MLS_BRIDGE_DATASET en el entorno. Solo LEE: pide una
 * página pequeña, imprime nombres de campo y valores de geografía, y no escribe nada en
 * la base de datos.
 *
 * NO imprime el listing completo: el contenido licenciado no debe acabar en un log o en
 * el scrollback de una terminal. Solo nombres de campo y los valores de geografía, que es
 * lo único que hace falta para verificar.
 */
import {
  COUNTY_FIELD_CANDIDATES,
  STATE_FIELD_CANDIDATES,
  SUPPORTED_COUNTIES,
  normalizeGeoName,
  coverageVerdict,
} from "../src/lib/mls/coverage";
import { buildReplicationUrl } from "../src/lib/mls/bridge-adapter";
import type { ResoListing } from "../src/lib/mls/feed-port";

async function main() {
  const token = process.env.MLS_BRIDGE_SERVER_TOKEN;
  const dataset = process.env.MLS_BRIDGE_DATASET;
  if (!token || !dataset) {
    console.error("Faltan MLS_BRIDGE_SERVER_TOKEN y/o MLS_BRIDGE_DATASET.");
    process.exit(1);
  }

  const url = buildReplicationUrl(dataset, null, 20);
  console.log(`Pidiendo 20 registros del dataset "${dataset}"…\n`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`Bridge respondió ${res.status}.`);
    console.error("Si es 401/403, revisa el token. Si es 404, el nombre del dataset o la ruta");
    console.error("/replication podrían no ser los asumidos — ver bridge-adapter.ts [SIN VERIFICAR].");
    process.exit(1);
  }

  const body = (await res.json()) as { value?: unknown[] };
  const listings = (body.value ?? []) as ResoListing[];
  if (listings.length === 0) {
    console.error("El feed devolvió 0 registros. Nada que inspeccionar.");
    process.exit(1);
  }

  console.log(`✓ ${listings.length} registros recibidos.\n`);

  // 1 · ¿Existen los campos que asumimos?
  console.log("─── Campos de geografía asumidos ───");
  let condadoOk = false;
  for (const f of COUNTY_FIELD_CANDIDATES) {
    const n = listings.filter((l) => normalizeGeoName(l[f]) !== null).length;
    console.log(`  ${f.padEnd(20)} presente en ${n}/${listings.length}`);
    if (n > 0) condadoOk = true;
  }
  for (const f of STATE_FIELD_CANDIDATES) {
    const n = listings.filter((l) => normalizeGeoName(l[f]) !== null).length;
    console.log(`  ${f.padEnd(20)} presente en ${n}/${listings.length}`);
  }

  // 2 · Si ninguno aparece, ¿cuál es el campo real?
  if (!condadoOk) {
    console.log("\n⚠️  NINGÚN candidato de condado apareció. Campos que SÍ contienen 'county'");
    console.log("    o 'state' en su nombre, para añadir a COUNTY_FIELD_CANDIDATES:");
    const claves = new Set<string>();
    for (const l of listings) {
      for (const k of Object.keys(l)) {
        if (/count(y|ies)|parish|state|province|region/i.test(k)) claves.add(k);
      }
    }
    for (const k of [...claves].sort()) {
      const ejemplo = listings.find((l) => typeof l[k] === "string" && (l[k] as string).trim());
      console.log(`      ${k.padEnd(28)} ej: ${String(ejemplo?.[k] ?? "—").slice(0, 40)}`);
    }
  }

  // 3 · Valores reales de condado, y si el filtro los acepta.
  console.log("\n─── Condados observados y veredicto del filtro ───");
  const porCondado = new Map<string, { n: number; incluido: boolean }>();
  for (const l of listings) {
    const v = coverageVerdict(l);
    const clave = v.included ? v.county : (v.reason === "county_field_missing" ? "(sin campo)" : String(v.detail ?? v.reason));
    const prev = porCondado.get(clave) ?? { n: 0, incluido: v.included };
    porCondado.set(clave, { n: prev.n + 1, incluido: v.included });
  }
  for (const [c, { n, incluido }] of [...porCondado].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${incluido ? "✓ INCLUIDO" : "✗ excluido"}  ${String(n).padStart(3)}  ${c}`);
  }

  console.log(`\n─── Cobertura configurada ───\n  ${SUPPORTED_COUNTIES.join(" · ")}`);
  const incluidos = [...porCondado.values()].filter((v) => v.incluido).reduce((a, b) => a + b.n, 0);
  if (incluidos === 0) {
    console.log("\n⚠️  CERO registros pasaron el filtro. O el nombre del campo es otro, o esta");
    console.log("    muestra no trae listings de los tres condados. Revisar antes de sincronizar.");
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
