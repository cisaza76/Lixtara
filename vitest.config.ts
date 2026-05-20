import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mirror the `@/` → `src/` path alias from tsconfig.json so tests import the
// same way app code does. Pure unit tests run in the node environment — no DOM,
// no Supabase, no external services.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
