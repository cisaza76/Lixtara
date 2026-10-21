import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { SITEMAP_PATHS } from "@/lib/sitemap-routes";
import { PRIVATE_SECTIONS } from "@/lib/seo";

const ROOT = resolve(__dirname, "../..");
const LANG_DIR = join(ROOT, "src/app/[lang]");

// Pages under src/app/[lang] that are not in the sitemap and are not a PRIVATE_SECTION.
const EXCLUDED: Record<string, string> = {
  "/owners": "noindex: cold-email landing",
  "/property/[id]": "one entry per active listing, added by src/app/sitemap.ts",
  "/[...rest]": "catch-all 404",
};

function pagePaths(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return pagePaths(p);
    return name === "page.tsx" ? [`/${relative(LANG_DIR, dir)}`.replace(/\/$/, "")] : [];
  });
}

// The page and every layout above it, up to src/app/[lang].
function sources(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  const files = [join(LANG_DIR, ...segments, "page.tsx")];
  for (let i = segments.length; i >= 0; i--) {
    const layout = join(LANG_DIR, ...segments.slice(0, i), "layout.tsx");
    if (existsSync(layout)) files.push(layout);
  }
  return files;
}

const NOINDEX = /index:\s*false|noindex/;
const SESSION = /\.auth\.get(User|Session)\(/;

describe("sitemap: one list of public, indexable pages", () => {
  it.each(SITEMAP_PATHS)("'%s' is a page, not noindex, private or behind a session", (path) => {
    expect(existsSync(join(LANG_DIR, path, "page.tsx")), path).toBe(true);
    expect(PRIVATE_SECTIONS).not.toContain(path.split("/")[1]);
    expect(path in EXCLUDED, path).toBe(false);
    for (const f of sources(path)) {
      const src = readFileSync(f, "utf8");
      expect(src, relative(ROOT, f)).not.toMatch(NOINDEX);
      if (f.endsWith("page.tsx")) expect(src, relative(ROOT, f)).not.toMatch(SESSION);
    }
  });

  it("every page under src/app/[lang] is in the sitemap, private or excluded with a reason", () => {
    const listed = new Set<string>(SITEMAP_PATHS);
    const unclassified = pagePaths(LANG_DIR).filter(
      (p) => !listed.has(p) && !PRIVATE_SECTIONS.includes(p.split("/")[1]) && !(p in EXCLUDED),
    );
    expect(unclassified).toEqual([]);
  });

  it("every exclusion is still a page", () => {
    for (const p of Object.keys(EXCLUDED)) expect(existsSync(join(LANG_DIR, p, "page.tsx")), p).toBe(true);
  });

  it("the detector catches /owners (noindex)", () => {
    expect(sources("/owners").some((f) => NOINDEX.test(readFileSync(f, "utf8")))).toBe(true);
  });

  it("sitemap.ts builds from SITEMAP_PATHS only", () => {
    const src = readFileSync(join(ROOT, "src/app/sitemap.ts"), "utf8");
    expect(src).toContain("SITEMAP_PATHS.flatMap");
    expect(src).not.toMatch(/"\/(about|contact|services|owners)"/);
  });
});
