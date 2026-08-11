/**
 * Arnés E2E del ciclo de vida del Source Video (contrato del PR #121).
 *
 *   upload → source vigente → remove → source inexistente → reupload → source vigente
 *
 * Ejecuta el contrato completo contra un despliegue real usando la CUENTA QA, nunca la de una
 * persona. No llama a /generate: el grant se crea con max_generations=0, así que generar es
 * IMPOSIBLE por construcción, no solo "no invocado". El listing QA vive siempre en draft, de
 * modo que jamás aparece en la web pública.
 *
 *   pnpm e2e:source            # ambos fixtures contra Production
 *   E2E_APP_ORIGIN=… pnpm e2e:source
 *
 * Seguro ante interrupciones: pre-limpia antes de empezar y limpia en finally.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createQaSession, type QaSession } from "./lib/qa-session";
import {
  service,
  listAssets,
  countRemovalAudits,
  jobsFingerprint,
  quotaOf,
  ensureQaListing,
  createGrant,
  revokeGrant,
  revokeAllQaGrants,
  purgeQaArtifacts,
  objectExists,
  sha256,
  QA_LISTING_MARKER,
} from "./lib/db-assert";
import { Recorder, classifyHttpFailure } from "./lib/outcome";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.env.E2E_APP_ORIGIN ?? "https://lixtara.com";

const FIXTURES = [
  { name: "MP4/H.264 SDR", file: "qa-source.mp4", mime: "video/mp4", ext: "mp4" },
  { name: "MOV/H.264 SDR", file: "qa-source.mov", mime: "video/quicktime", ext: "mov" },
] as const;

type Fixture = (typeof FIXTURES)[number];

async function api(
  session: QaSession,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: session.cookieHeader },
    redirect: "manual",
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

/** Sube el fixture y devuelve el assetId registrado. Pasos 5–7 del contrato. */
async function upload(session: QaSession, listingId: string, fx: Fixture, bytes: Uint8Array, rec: Recorder) {
  const ini = await api(session, "/api/creative-studio/video/source/initiate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ listingId, fileName: fx.file, mimeType: fx.mime, sizeBytes: bytes.byteLength }),
  });
  if (ini.status !== 200) {
    const c = classifyHttpFailure({ status: ini.status, phase: "run", step: `initiate ${fx.ext}` });
    rec.fail(`initiate ${fx.ext}`, c.reason);
    return null;
  }
  const up = ini.json as { assetId: string; storagePath: string; upload: { signedUrl: string } };
  rec.ok(`5. initiate ${fx.ext}`, `assetId ${up.assetId.slice(0, 8)}`);

  // PUT REAL de los bytes contra la URL firmada (mismo camino que el navegador).
  const put = await fetch(up.upload.signedUrl, {
    method: "PUT",
    headers: { "content-type": fx.mime },
    body: bytes as unknown as BodyInit,
  });
  if (!put.ok) {
    rec.fail(`6. PUT ${fx.ext}`, `HTTP ${put.status}`);
    return null;
  }
  rec.ok(`6. PUT real ${fx.ext}`, `${bytes.byteLength} bytes`);

  const done = await api(session, "/api/creative-studio/video/source/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ listingId, assetId: up.assetId, storagePath: up.storagePath }),
  });
  if (done.status !== 200) {
    const c = classifyHttpFailure({ status: done.status, phase: "run", step: `complete ${fx.ext}` });
    rec.fail(`7. complete ${fx.ext}`, `${c.reason} ${JSON.stringify(done.json)}`);
    return null;
  }
  rec.ok(`7. complete ${fx.ext}`, `registered=${done.json.registered}`);
  return done.json.assetId as string;
}

async function runFixture(session: QaSession, listingId: string, grantId: string, fx: Fixture, rec: Recorder) {
  const db = service();
  const bytes = new Uint8Array(readFileSync(join(HERE, "fixtures", fx.file)));
  const localSha = sha256(bytes);
  rec.ok(`fixture ${fx.name}`, `sha256 ${localSha.slice(0, 16)}… (${bytes.byteLength} B)`);

  const jobsBefore = await jobsFingerprint(db);
  const quotaBefore = await quotaOf(db, grantId);

  const assetId = await upload(session, listingId, fx, bytes, rec);
  if (!assetId) return;

  // 8. GET /source → exists:true
  const read1 = await api(session, `/api/creative-studio/video/source?listingId=${listingId}`);
  rec.check(`8. GET /source exists:true (${fx.ext})`, read1.status === 200 && read1.json.exists === true, JSON.stringify(read1.json));

  // 9. round-trip SHA-256 por la ruta de preview de la propia app
  const prev = await api(session, `/api/creative-studio/video/source/preview?listingId=${listingId}`);
  // Forma real del DTO (source-preview.ts#toSourcePreviewDto): { exists, preview: { access, meta } }.
  const locator = (prev.json as { preview?: { access?: { locator?: string } } }).preview?.access?.locator;
  if (locator) {
    const dl = await fetch(locator);
    const back = new Uint8Array(await dl.arrayBuffer());
    const rtSha = sha256(back);
    rec.check(`9. SHA-256 round-trip (${fx.ext})`, rtSha === localSha, `local ${localSha.slice(0, 12)} vs remoto ${rtSha.slice(0, 12)}`);
  } else {
    rec.fail(`9. SHA-256 round-trip (${fx.ext})`, `sin locator de preview: ${JSON.stringify(prev.json).slice(0, 120)}`);
  }

  const beforeDelete = await listAssets(db, listingId);
  const target = beforeDelete.find((a) => a.id === assetId);
  const provenanceBefore = JSON.stringify(target?.provenance ?? null);
  const pathBefore = target?.storage_path ?? "";

  // 10. DELETE
  const del1 = await api(session, `/api/creative-studio/video/source?listingId=${listingId}`, { method: "DELETE" });
  if (del1.status !== 200) {
    const c = classifyHttpFailure({ status: del1.status, phase: "run", step: `DELETE ${fx.ext}` });
    rec.fail(`10. DELETE (${fx.ext})`, c.reason);
    return;
  }
  rec.ok(`10. DELETE (${fx.ext})`, JSON.stringify(del1.json));

  // 11. GET /source → exists:false
  const read2 = await api(session, `/api/creative-studio/video/source?listingId=${listingId}`);
  rec.check(`11. GET /source exists:false (${fx.ext})`, read2.json.exists === false, JSON.stringify(read2.json));

  // 12–15. estado del asset y de Storage
  const after = await listAssets(db, listingId);
  const row = after.find((a) => a.id === assetId);
  rec.check(`12. lifecycle=archived (${fx.ext})`, row?.lifecycle === "archived", `lifecycle=${row?.lifecycle}`);
  rec.check(`13. archived_at poblado (${fx.ext})`, Boolean(row?.archived_at), `archived_at=${row?.archived_at}`);

  // Oráculo autoritativo: el catálogo de Storage. La URL firmada NO sirve — el CDN puede
  // seguir devolviendo 200 con una copia cacheada durante un tiempo tras el borrado.
  const stillThere = await objectExists(db, pathBefore);
  rec.check(`14. objeto eliminado de Storage (${fx.ext})`, !stillThere, stillThere ? `sigue en storage.objects: ${pathBefore}` : "ausente del catálogo");

  rec.check(
    `15. provenance conservada (${fx.ext})`,
    JSON.stringify(row?.provenance ?? null) === provenanceBefore && row?.storage_path === pathBefore,
    "provenance y storage_path intactos",
  );

  // 16. auditoría exactamente una vez
  const audits = await countRemovalAudits(db, listingId, assetId);
  rec.check(`16. audit video_source_removed ×1 (${fx.ext})`, audits === 1, `encontrados: ${audits}`);

  // 17–19. nada colateral
  rec.check(`17. jobs sin cambios (${fx.ext})`, (await jobsFingerprint(db)) === jobsBefore, jobsBefore);
  const quotaAfter = await quotaOf(db, grantId);
  rec.check(
    `18. cuota sin cambios (${fx.ext})`,
    quotaAfter?.used === quotaBefore?.used && quotaAfter?.used === 0,
    `used=${quotaAfter?.used}/${quotaAfter?.max}`,
  );
  rec.check(
    `19. sin generated assets afectados (${fx.ext})`,
    after.every((a) => a.source_type === "seller_upload"),
    `kinds: ${[...new Set(after.map((a) => `${a.kind}/${a.source_type}`))].join(",")}`,
  );

  // 20. segundo DELETE idempotente
  const del2 = await api(session, `/api/creative-studio/video/source?listingId=${listingId}`, { method: "DELETE" });
  const auditsAfter2 = await countRemovalAudits(db, listingId, assetId);
  rec.check(
    `20. 2º DELETE idempotente (${fx.ext})`,
    del2.status === 200 && del2.json.removed === false && auditsAfter2 === 1,
    `status=${del2.status} body=${JSON.stringify(del2.json)} audits=${auditsAfter2}`,
  );

  // 21–22. reupload y nuevo vigente
  const assetId2 = await upload(session, listingId, fx, bytes, rec);
  if (!assetId2) return;
  const read3 = await api(session, `/api/creative-studio/video/source?listingId=${listingId}`);
  const current = (read3.json as { source?: { assetId?: string } }).source?.assetId;
  rec.check(`22. nuevo source vigente (${fx.ext})`, read3.json.exists === true && current === assetId2, `vigente=${current?.slice(0, 8)}`);

  // 23. ningún archivado reaparece
  rec.check(`23. archivado no reaparece (${fx.ext})`, current !== assetId, `archivado=${assetId.slice(0, 8)} vigente=${current?.slice(0, 8)}`);

  // El reupload de este fixture se archiva antes de pasar al siguiente, para dejar el
  // listing sin source vigente y que el siguiente fixture parta de un estado limpio.
  await api(session, `/api/creative-studio/video/source?listingId=${listingId}`, { method: "DELETE" });
}

async function main() {
  const rec = new Recorder();
  const db = service();
  let grantId: string | null = null;
  let listingId = "";

  try {
    // 1. autenticación QA
    const session = await createQaSession(ORIGIN);
    rec.ok("1. auth QA", `user ${session.userId.slice(0, 8)} @ ${ORIGIN}`);

    // 2–3. listing QA en draft + pre-limpieza idempotente
    listingId = await ensureQaListing(db, session.userId);
    rec.ok(`2. listing QA draft (${QA_LISTING_MARKER})`, listingId.slice(0, 8));
    const revoked = await revokeAllQaGrants(db, session.userId);
    const purged = await purgeQaArtifacts(db, listingId);
    rec.ok("pre-clean", `grants revocados=${revoked}, objetos=${purged.objects}, assets=${purged.assets}`);

    // 4. grant temporal: max_generations=0 → /generate imposible por construcción
    grantId = await createGrant(db, {
      userId: session.userId,
      listingId,
      maxGenerations: 0,
      reason: "E2E source-lifecycle harness (PR #121). Temporal, per-listing, sin generación.",
    });
    rec.ok("3-4. grant temporal", `${grantId.slice(0, 8)} max_generations=0`);

    // Precondición: la ventana de rate limit debe estar libre ANTES de empezar.
    const probe = await api(session, `/api/creative-studio/video/source?listingId=${listingId}`);
    if (probe.status === 429) {
      const c = classifyHttpFailure({ status: probe.status, phase: "precondition", step: "probe GET /source" });
      rec.abort("precondición", c.reason);
      return rec;
    }
    if (probe.status !== 200) {
      rec.fail("precondición", `GET /source devolvió ${probe.status}: ${JSON.stringify(probe.json)}`);
      return rec;
    }
    rec.ok("precondición", `GET /source 200, exists=${probe.json.exists}`);

    for (const fx of FIXTURES) await runFixture(session, listingId, grantId, fx, rec);
  } catch (err) {
    rec.fail("excepción", err instanceof Error ? err.message : String(err));
  } finally {
    // Limpieza garantizada. La AUDITORÍA NO SE TOCA: es evidencia legítima del contrato.
    try {
      if (grantId) await revokeGrant(db, grantId);
      if (listingId) {
        const purged = await purgeQaArtifacts(db, listingId);
        rec.ok("cleanup", `grant revocado, objetos=${purged.objects}, assets=${purged.assets}, listing sigue draft`);
      }
    } catch (e) {
      rec.abort("cleanup", e instanceof Error ? e.message : String(e));
    }
  }
  return rec;
}

main().then((rec) => {
  console.log(`\n=== E2E source-lifecycle @ ${ORIGIN} ===\n`);
  console.log(rec.render());
  const outcome = rec.outcome();
  console.log(`\nRESULTADO: ${outcome}\n`);
  process.exit(outcome === "PASS" ? 0 : 1);
});
