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

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) specs.push(m[1] ?? m[2]!);
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
