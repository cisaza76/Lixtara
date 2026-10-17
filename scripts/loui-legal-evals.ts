// Evalúa Ask Loui contra el modelo real con los casos de src/lib/loui-legal-cases.ts.
// Envía SOLO las preguntas de prueba (sin datos de usuarios ni del MLS).
//   pnpm exec tsx --env-file=.env.local scripts/loui-legal-evals.ts
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { LOUI_SYSTEM_PROMPT } from "../src/lib/loui-prompt";
import { LOUI_LEGAL_CASES } from "../src/lib/loui-legal-cases";

const MODEL = "claude-sonnet-4-6"; // el mismo de src/app/api/loui/route.ts

async function main() {
  let failed = 0;
  for (const c of LOUI_LEGAL_CASES) {
    const { text } = await generateText({
      model: anthropic(MODEL),
      system: LOUI_SYSTEM_PROMPT,
      prompt: c.question,
    });
    const bad = c.mustNot.filter((r) => r.test(text)).map(String);
    const missing = c.must.filter((r) => !r.test(text)).map(String);
    const ok = bad.length === 0 && missing.length === 0;
    if (!ok) failed++;
    console.log(`\n${ok ? "OK  " : "FAIL"} [${c.lang}] ${c.question}\n${text}`);
    if (bad.length) console.log(`  dijo lo prohibido: ${bad.join(", ")}`);
    if (missing.length) console.log(`  le faltó: ${missing.join(", ")}`);
  }
  console.log(`\n${LOUI_LEGAL_CASES.length - failed}/${LOUI_LEGAL_CASES.length} casos OK`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
