import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

// ════════════════════════════════════════════════════════════════════════════
// FRONTERA MLS ⇄ IA  —  § III.B.4 del acuerdo de datos de MIAMI AOR
//
//   "Feed license Licensed Content, DIRECTLY OR INDIRECTLY, to any generative
//    artificial intelligence model ('AI') ... and/or chatbots, for any purpose,
//    including but not limited to machine processing ..."
//
// "Indirectly" es lo que obliga a mirar el cierre TRANSITIVO de imports, no solo
// los directos: si Loui importa un helper y ese helper importa el módulo de MLS,
// el contenido licenciado ya está al alcance del prompt.
//
// Este test construye el grafo de imports de src/ y verifica que ninguna
// superficie de IA alcance src/lib/mls/ por ningún camino.
// ════════════════════════════════════════════════════════════════════════════

const SRC = resolve(__dirname, "../..");            // .../src
const MLS_DIR = "lib/mls";                          // relativo a src/

/** Paquetes cuya sola presencia convierte a un módulo en superficie de IA. */
const AI_PACKAGES = ["ai", "@ai-sdk/anthropic", "@ai-sdk/react", "@google/genai"] as const;

/**
 * Superficies de IA que NO importan un SDK porque llaman al proveedor por HTTP,
 * o que son la carga útil del prompt. La autodetección sola no las ve.
 */
const AI_MODULES_WITHOUT_SDK = [
  "lib/luma.ts",        // Luma Uni-1 por fetch
  "lib/loui-prompt.ts", // el prompt de sistema de Loui
] as const;

// ── Grafo de imports ────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

// Tres formas: `import … from "x"` / `export … from "x"`, `import("x")`, y el import de
// efecto lateral `import "x"` — este último se escapaba del grafo (verificado con una
// mutación el 2026-09-26: un `import "@/lib/…"` añadido a la ruta de Loui no se detectaba).
const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s*["']([^"']+)["']/g;

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) specs.push(m[1] ?? m[2] ?? m[3]!);
  return specs;
}

/** Resuelve un especificador a una ruta relativa a src/, o null si es externo. */
function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // paquete externo
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(cand) && statSync(cand).isFile()) return relative(SRC, cand);
  }
  return null;
}

const files = walk(SRC).map((f) => relative(SRC, f));
const graph = new Map<string, string[]>();
const externals = new Map<string, string[]>();
for (const rel of files) {
  const abs = join(SRC, rel);
  const specs = importsOf(abs);
  graph.set(rel, specs.map((s) => resolveSpec(s, abs)).filter((x): x is string => x !== null));
  externals.set(rel, specs.filter((s) => !s.startsWith(".") && !s.startsWith("@/")));
}

/** Módulos que importan directamente un SDK de IA. */
const autoDetected = files.filter((f) =>
  (externals.get(f) ?? []).some((p) => (AI_PACKAGES as readonly string[]).includes(p)),
);
const aiSurfaces = [...new Set([...autoDetected, ...AI_MODULES_WITHOUT_SDK])]
  .filter((f) => files.includes(f))
  .sort();

/** Cierre transitivo de imports desde `entry`, con la ruta que lo alcanzó. */
function reaches(entry: string, targetPrefix: string): string[] | null {
  const seen = new Set<string>();
  const stack: Array<{ file: string; path: string[] }> = [{ file: entry, path: [entry] }];
  while (stack.length) {
    const { file, path } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file !== entry && file.startsWith(targetPrefix)) return path;
    for (const dep of graph.get(file) ?? []) {
      if (!seen.has(dep)) stack.push({ file: dep, path: [...path, dep] });
    }
  }
  return null;
}

/** Cierre transitivo completo desde `entry` (incluido). */
function closure(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const dep of graph.get(f) ?? []) if (!seen.has(dep)) stack.push(dep);
  }
  return seen;
}

/**
 * Referencias al almacenamiento del feed escritas A MANO: `.from("mls_listings")` o una
 * consulta SQL no necesitan importar src/lib/mls/, así que el guard de imports no las ve.
 */
const MLS_TABLE_RE = /\bmls_(listings|sync_state)\b/;
/** Quita comentarios: documentar la regla (p. ej. "nunca leer mls_listings") no es violarla. */
const sinComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const mentionsMlsTables = (rel: string) =>
  !rel.startsWith(MLS_DIR) && MLS_TABLE_RE.test(sinComentarios(readFileSync(join(SRC, rel), "utf8")));

const isTest = (f: string) => /\.test\.tsx?$/.test(f) || f.endsWith(".fake.ts");

/**
 * Módulos de SERVIDOR que ALCANZAN una superficie de IA: las rutas de Loui, de Gemini
 * (tours), de Media Intelligence, etc. El riesgo no es solo que la IA importe el MLS, sino
 * que una ruta que importa AMBOS lea filas del feed y se las pase al modelo — que es justo
 * cómo se armaría una recomendación de precio.
 *
 * SOLO servidor (`app/api/**` y `.ts` de `lib/`), NO páginas ni componentes `.tsx`: ADR-0014
 * rechazó prohibir la co-ubicación en la UI (el layout pinta el widget de Loui; una página
 * con fichas del MLS y el widget es co-ubicación, no flujo de datos). Ahí manda la marca
 * de tipo `MlsLicensed<T>` / `AiSafe<T>`.
 */
const isServerModule = (f: string) =>
  f.startsWith("app/api/") || (f.startsWith("lib/") && f.endsWith(".ts"));
const aiReachers = files.filter((f) =>
  !isTest(f) && isServerModule(f) && aiSurfaces.some((s) => closure(f).has(s)));

/**
 * Rutas de precio o valuación, EXISTAN O NO todavía: cualquier segmento de ruta que
 * empiece por `pric`, `valuation` o `cma` (≈ globs **\/pric*, **\/valuation*, **\/cma*).
 * Hoy no hay ninguna ruta de recomendación de precio en src/; el día que se cree, nace
 * bajo este guard. ADR-0014 tachó el plan F3.3 de mezclar MLS + IA para el precio.
 */
export const PRICING_SEGMENT_RE = /^(pric|valuation|cma)/i;
const isPricingPath = (rel: string) => rel.split("/").some((seg) => PRICING_SEGMENT_RE.test(seg));
const pricingModules = files.filter((f) => !isTest(f) && !f.startsWith(MLS_DIR) && isPricingPath(f));

/** Violaciones de un módulo: ¿su cierre alcanza src/lib/mls/ o nombra las tablas del feed? */
function mlsViolations(entry: string): string[] {
  const out: string[] = [];
  const path = reaches(entry, MLS_DIR);
  if (path) out.push(`${path.join(" → ")}  [import de src/lib/mls/]`);
  for (const f of closure(entry)) {
    if (!isTest(f) && mentionsMlsTables(f)) out.push(`${entry} ⇝ ${f}  [nombra mls_listings/mls_sync_state]`);
  }
  return out;
}

// ── El guard ────────────────────────────────────────────────────────────────
describe("frontera MLS ⇄ IA (§ III.B.4)", () => {
  it("detecta las superficies de IA conocidas", () => {
    // Si este test cae, la autodetección se rompió y el guard de abajo estaría
    // pasando en vacío.
    for (const known of [
      "lib/ai.ts",
      "lib/luma.ts",
      "lib/loui-prompt.ts",
      "app/api/loui/route.ts",
      "lib/media-intelligence/classify.ts",
      "lib/tour/processors/gemini-video.ts",
    ]) {
      expect(aiSurfaces, `no se detectó como superficie de IA: ${known}`).toContain(known);
    }
    expect(aiSurfaces.length).toBeGreaterThanOrEqual(6);
  });

  it("NINGUNA superficie de IA alcanza src/lib/mls/, ni directa ni transitivamente", () => {
    const violations: string[] = [];
    for (const surface of aiSurfaces) {
      const path = reaches(surface, MLS_DIR);
      if (path) violations.push(path.join("\n      → "));
    }
    expect(
      violations,
      violations.length
        ? `El § III.B.4 del acuerdo de MIAMI AOR prohíbe alimentar contenido del MLS a ` +
          `modelos de IA "directly or indirectly". Estas cadenas de import lo permiten:\n\n      ` +
          violations.join("\n\n      ") + "\n"
        : "",
    ).toEqual([]);
  });

  it("src/lib/mls/ no importa ninguna superficie de IA (la fuga inversa)", () => {
    const mlsFiles = files.filter((f) => f.startsWith(MLS_DIR) && !f.endsWith(".test.ts"));
    expect(mlsFiles.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const f of mlsFiles) {
      for (const pkg of externals.get(f) ?? []) {
        if ((AI_PACKAGES as readonly string[]).includes(pkg)) violations.push(`${f} → ${pkg}`);
      }
      for (const dep of graph.get(f) ?? []) {
        if (aiSurfaces.includes(dep)) violations.push(`${f} → ${dep}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("el grafo se construyó de verdad (el guard no pasa en vacío)", () => {
    expect(files.length).toBeGreaterThan(100);
    // lib/ai.ts tiene imports resueltos o externos: prueba que el parser funciona.
    expect((graph.get("lib/ai.ts") ?? []).length + (externals.get("lib/ai.ts") ?? []).length)
      .toBeGreaterThan(0);
    // Y una arista conocida se resuelve correctamente.
    expect(graph.get("app/api/loui/route.ts") ?? []).toContain("lib/loui-prompt.ts");
  });
});

// ── E · Huecos cerrados (2026-09-26) ─────────────────────────────────────────
describe("frontera MLS ⇄ IA — cadenas y rutas que alcanzan la IA", () => {
  it("ninguna superficie de IA ni su cierre NOMBRA mls_listings / mls_sync_state", () => {
    // `.from("mls_listings")` no pasa por un import: el guard de imports no lo vería.
    const violations = aiSurfaces.flatMap((s) =>
      [...closure(s)].filter((f) => !isTest(f) && mentionsMlsTables(f)).map((f) => `${s} ⇝ ${f}`));
    expect(violations).toEqual([]);
  });

  it("ninguna ruta/módulo de servidor que ALCANZA la IA (Loui, Gemini, Media…) toca el MLS", () => {
    // Detecta el caso "hermano": una ruta que importa a la vez el SDK y el lector del feed.
    expect(aiReachers).toEqual(expect.arrayContaining(["app/api/loui/route.ts"]));
    expect(aiReachers.length).toBeGreaterThan(aiSurfaces.length);
    const violations = aiReachers.flatMap(mlsViolations);
    expect(
      violations,
      violations.length
        ? `§ III.B.4: un módulo que llega a un modelo de IA no puede leer contenido del MLS:\n  ` +
          violations.join("\n  ")
        : "",
    ).toEqual([]);
  });

  it("ninguna ruta de precio / valuación / CMA toca el MLS, exista hoy o no", () => {
    const violations = pricingModules.flatMap(mlsViolations);
    expect(violations).toEqual([]);
  });

  it("el patrón de rutas de precio reconoce los globs pedidos y no se dispara en falso", () => {
    for (const p of ["app/api/pricing/route.ts", "app/api/price-recommendation/route.ts",
                     "lib/valuation.ts", "lib/valuation/comps.ts", "app/[lang]/cma/page.tsx",
                     "lib/CMA-report.ts", "lib/pricing-tiers.ts",
                     // Por prefijo, como el glob: sobre-incluir es el lado seguro.
                     "components/price-tag.tsx"]) {
      expect(isPricingPath(p), p).toBe(true);
    }
    for (const p of ["lib/properties.ts", "app/api/loui/route.ts", "lib/mls/coverage.ts",
                     "components/listing-card.tsx", "lib/comparables.ts"]) {
      expect(isPricingPath(p), p).toBe(false);
    }
  });

  it("el guard de cadenas no pasa en vacío: sí ve las tablas donde deben estar", () => {
    // Los lectores del feed viven en src/lib/mls/ y se excluyen a propósito; un archivo
    // fuera de ahí que las nombrara sí se detecta.
    expect(MLS_TABLE_RE.test('db.from("mls_listings")')).toBe(true);
    expect(MLS_TABLE_RE.test("select * from public.mls_sync_state")).toBe(true);
    expect(MLS_TABLE_RE.test("mls_number")).toBe(false);
    expect(MLS_TABLE_RE.test(sinComentarios('// nunca leer mls_listings aquí\nconst a = 1;'))).toBe(false);
    expect(MLS_TABLE_RE.test(sinComentarios('/* mls_listings */ db.from("mls_listings")'))).toBe(true);
  });
});

