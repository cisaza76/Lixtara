import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Regression guard (2026-10-07): a server action defined inside a page that
// calls a plain helper ALSO defined inside that page captures the helper, and
// Next.js cannot serialize a function into the action's bound arguments. The
// page then crashes in production with "Functions cannot be passed directly to
// Client Components" (this broke Approve on the admin listing review and every
// action on seven other admin pages). Helpers used by server actions must live
// at module scope or in a lib module (e.g. assertStaff in src/lib/admin-auth.ts).

const APP = resolve(__dirname, "../app");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Body of the function whose opening brace is at `open` (naive brace match). */
function blockFrom(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

function offenders(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const page = /export default async function \w+\([^]*?\)\s*(?::[^{]+)?\{/.exec(src);
  if (!page || !src.includes('"use server"')) return [];
  const body = blockFrom(src, page.index + page[0].length - 1);

  const helpers: string[] = [];
  const actions: { name: string; body: string }[] = [];
  for (const m of body.matchAll(/\n {2}(?:async )?function (\w+)\([^]*?\)\s*(?::[^{]+)?\{/g)) {
    const fnBody = blockFrom(body, m.index! + m[0].length - 1);
    if (/^\{\s*["']use server["']/.test(fnBody)) actions.push({ name: m[1], body: fnBody });
    else helpers.push(m[1]);
  }
  for (const m of body.matchAll(/\n {2}const (\w+) = (?:async )?\([^)]*\)[^=]*=>/g)) helpers.push(m[1]);

  const found: string[] = [];
  for (const a of actions) {
    for (const h of helpers) {
      if (new RegExp(`\\b${h}\\(`).test(a.body)) found.push(`${a.name} → ${h}`);
    }
  }
  return found;
}

describe("server actions don't capture in-page helper functions", () => {
  it("no page action calls a non-action function declared inside the page", () => {
    const bad: Record<string, string[]> = {};
    for (const file of walk(APP)) {
      const o = offenders(file);
      if (o.length) bad[relative(APP, file)] = o;
    }
    expect(bad).toEqual({});
  });
});
