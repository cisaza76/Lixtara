// Loads .env.local for the DocuSign scripts, multi-line quoted values included
// (DOCUSIGN_PRIVATE_KEY spans several lines in PEM format). Same loader as
// scripts/check-docusign-template.ts. Import it FIRST: the DocuSign wrapper reads env at call time.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  const lines = readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n");
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const eq = trimmed.indexOf("=");
    if (!trimmed || trimmed.startsWith("#") || eq === -1) {
      i += 1;
      continue;
    }
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1);
    if (v.startsWith('"')) {
      v = v.slice(1);
      const parts: string[] = [];
      if (v.endsWith('"') && !v.endsWith('\\"')) {
        parts.push(v.slice(0, -1));
        i += 1;
      } else {
        parts.push(v);
        i += 1;
        while (i < lines.length) {
          const next = lines[i];
          i += 1;
          if (next.endsWith('"')) {
            parts.push(next.slice(0, -1));
            break;
          }
          parts.push(next);
        }
      }
      if (!process.env[k]) process.env[k] = parts.join("\n").replace(/\n/g, "\\n");
    } else {
      let val = v.trim();
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (!process.env[k]) process.env[k] = val;
      i += 1;
    }
  }
} catch {
  // .env.local optional — vars may come from the shell.
}
