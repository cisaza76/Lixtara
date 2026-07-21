import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { PLAYFAIR_500, PLAYFAIR_600, PLAYFAIR_500_ITALIC, INTER_600 } from "@/remotion/fonts-data";

const FONTS = path.join(process.cwd(), "public", "fonts");
const PREFIX = "data:font/woff2;base64,";
const cases: [file: string, uri: string][] = [
  ["PlayfairDisplay-500.woff2", PLAYFAIR_500],
  ["PlayfairDisplay-600.woff2", PLAYFAIR_600],
  ["PlayfairDisplay-500Italic.woff2", PLAYFAIR_500_ITALIC],
  ["Inter-600.woff2", INTER_600],
];

describe("fonts-data: fonts embedded as base64 data URIs (no in-sandbox HTTP font fetch)", () => {
  it("each constant is a woff2 data URI whose decoded bytes match the vendored file (guards staleness)", async () => {
    for (const [file, uri] of cases) {
      expect(uri.startsWith(PREFIX), `${file} must be a woff2 data URI`).toBe(true);
      const embedded = Buffer.from(uri.slice(PREFIX.length), "base64");
      const source = await readFile(path.join(FONTS, file));
      expect(embedded.equals(source), `${file} embed must byte-match public/fonts/${file}`).toBe(true);
    }
  });
});
