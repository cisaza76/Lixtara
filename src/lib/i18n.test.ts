import { describe, it, expect } from "vitest";
import { t, locales } from "@/lib/i18n";

// Collect every leaf + branch key path in a nested dictionary, e.g.
// "admin.pendingListingsHeader". Arrays are treated as leaves (their contents
// are copy, not structure).
function keyPaths(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return prefix ? [prefix] : [];
  }
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...keyPaths(value, path));
    } else {
      paths.push(path);
    }
  }
  return paths.sort();
}

describe("i18n dictionary parity", () => {
  it("exposes exactly the en/es locales", () => {
    expect([...locales].sort()).toEqual(["en", "es"]);
  });

  it("has identical key structure across en and es (no missing translations)", () => {
    const en = keyPaths(t("en"));
    const es = keyPaths(t("es"));

    const missingInEs = en.filter((k) => !es.includes(k));
    const missingInEn = es.filter((k) => !en.includes(k));

    // Surfaced in the assertion message so a failure names the exact gaps.
    expect({ missingInEs, missingInEn }).toEqual({
      missingInEs: [],
      missingInEn: [],
    });
  });
});
