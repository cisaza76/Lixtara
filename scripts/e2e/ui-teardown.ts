/**
 * Desmonta el estado de la capa B: revoca el grant y retira los artefactos sintéticos.
 * El listing QA permanece en draft y la auditoría NO se toca.
 *
 *   pnpm e2e:ui-teardown /ruta/session.json
 */
import { readFileSync } from "node:fs";
import { service, revokeAllQaGrants, purgeQaArtifacts } from "./lib/db-assert";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Uso: tsx scripts/e2e/ui-teardown.ts <ruta-session.json>");
  const { listingId, userId } = JSON.parse(readFileSync(path, "utf8")) as { listingId: string; userId: string };

  const db = service();
  const revoked = await revokeAllQaGrants(db, userId);
  const purged = await purgeQaArtifacts(db, listingId);
  console.log(`limpieza · grants revocados=${revoked} · objetos=${purged.objects} · assets=${purged.assets} · listing sigue draft`);
}

main();
