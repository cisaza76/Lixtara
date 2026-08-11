/**
 * Prepara el estado para la capa B (UI) y emite la sesión QA a un fichero local.
 *
 *   pnpm e2e:ui-setup /ruta/session.json
 *
 * Deja: listing QA en draft + grant temporal (max_generations=0) + UN source subido, que es
 * la precondición para que aparezcan "Replace video" y "Remove video".
 *
 * Las cookies se escriben a disco, NUNCA a stdout: son un token de sesión (de la cuenta QA,
 * no de una persona) y no deben acabar en un log ni en un transcript.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createQaSession } from "./lib/qa-session";
import { service, ensureQaListing, createGrant, revokeAllQaGrants, purgeQaArtifacts } from "./lib/db-assert";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.env.E2E_APP_ORIGIN ?? "https://lixtara.com";
const OUT = process.argv[2];
if (!OUT) throw new Error("Uso: tsx scripts/e2e/ui-setup.ts <ruta-de-salida.json>");

async function main() {
  const session = await createQaSession(ORIGIN);
  const db = service();

  const listingId = await ensureQaListing(db, session.userId);
  await revokeAllQaGrants(db, session.userId);
  await purgeQaArtifacts(db, listingId);
  const grantId = await createGrant(db, {
    userId: session.userId,
    listingId,
    maxGenerations: 0,
    reason: "E2E UI layer (PR #121). Temporal, per-listing, sin generación.",
  });

  // Sube el fixture MP4 para que la tarjeta muestre el estado "con source".
  const bytes = new Uint8Array(readFileSync(join(HERE, "fixtures", "qa-source.mp4")));
  const headers = { cookie: session.cookieHeader, "content-type": "application/json" };
  const ini = await fetch(`${ORIGIN}/api/creative-studio/video/source/initiate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ listingId, fileName: "qa-source.mp4", mimeType: "video/mp4", sizeBytes: bytes.byteLength }),
  }).then((r) => r.json() as Promise<{ assetId: string; storagePath: string; upload: { signedUrl: string } }>);

  await fetch(ini.upload.signedUrl, { method: "PUT", headers: { "content-type": "video/mp4" }, body: bytes as unknown as BodyInit });
  const done = await fetch(`${ORIGIN}/api/creative-studio/video/source/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ listingId, assetId: ini.assetId, storagePath: ini.storagePath }),
  }).then((r) => r.json() as Promise<{ assetId: string }>);

  writeFileSync(OUT, JSON.stringify({ cookies: session.cookies, listingId, grantId, userId: session.userId, sourceAssetId: done.assetId }, null, 2));
  // Solo identificadores en stdout: jamás las cookies.
  console.log(`listo · listing=${listingId} · grant=${grantId.slice(0, 8)} · source=${String(done.assetId).slice(0, 8)} · sesión escrita en ${OUT}`);
}

main();
