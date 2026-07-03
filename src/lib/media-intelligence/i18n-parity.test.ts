import { describe, it, expect } from "vitest";
import { dictionaries } from "@/lib/i18n";

describe("mediaAgent i18n", () => {
  it("has the same keys in en and es", () => {
    const en = Object.keys((dictionaries.en as Record<string, unknown>).mediaAgent ?? {}).sort();
    const es = Object.keys((dictionaries.es as Record<string, unknown>).mediaAgent ?? {}).sort();
    expect(en.length).toBeGreaterThan(0);
    expect(en).toEqual(es);
  });
});
