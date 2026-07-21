// Gate D1 (docs/superpowers/plans/2026-07-15-creative-studio-p2-video.md, Task 7):
// assembles the REAL `produce` + `reconcile` functions the worker's `PipelineDeps`
// (src/lib/video-engine/pipeline.ts) needs, out of the collaborators Gate B2/C1/C2
// already validated — `produceVideoAsset`, `SandboxRemotionProvider`,
// `SupabaseVideoStoragePort`, `SupabaseAssetStore`, ffprobe-based QA. Nothing here
// re-implements or re-validates any of those; this module is wiring only.
//
// EXCEPTION to this directory's "no @/lib/creative-jobs import" module-isolation rule
// (see produce-asset.test.ts's isolation test, which excludes this file by name for the
// same reason it already excludes pipeline.ts): `reconcile`'s signature is
// `(job: CreativeJob) => Promise<ReconcileResult>` — bridging the real DB to that
// pipeline-owned contract necessarily needs the `CreativeJob` type. `produceVideoAsset`
// itself, reached only through `buildRealProduce` below, still never imports
// `@/lib/creative-jobs` (unchanged from Gate B2).
//
// CODE ONLY as of this commit: `CREATIVE_STUDIO_VIDEO_ENABLED` and `CRON_SECRET` are
// both unset in every environment (see worker/route.ts), so `buildRealWorkerDeps` is
// constructed but never actually invoked end-to-end anywhere yet. One thing is
// deliberately left as a real (owner) infrastructure gap this module fails loudly on
// rather than silently working around: the Sandbox base artifact
// (`resolveSandboxBaseArtifactFromEnv` below) — not yet baked (see versions.ts's
// `BASE_ARTIFACT_VERSION` comment).
//
// Technical QA does NOT need an `ffprobe` binary on the worker's own runtime PATH:
// `SandboxRemotionProvider.render` (render-provider.ts) runs `ffprobe` INSIDE the
// render Sandbox — where the prebuilt artifact already has it — before the Sandbox
// stops, and returns the captured JSON as `RenderMediaOutput.ffprobeJson`. This
// module's `defaultRunQa` only PARSES that JSON (via qa.ts's pure `parseFfprobe`); it
// never shells out to anything.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Asset, AssetStore } from "@/lib/assets/types";
import { selectForCapability, wrapPropertyPhoto } from "@/lib/assets/asset-manager";
import { SupabaseAssetStore } from "@/lib/assets/asset-store.supabase";
import type { CreativeJob } from "@/lib/creative-jobs/jobs";
import type { OnStageHook, PipelineDeps, ReconcileResult } from "@/lib/video-engine/pipeline";
import { produceVideoAsset, type ProduceVideoAssetDeps } from "@/lib/video-engine/produce-asset";
import {
  SandboxRemotionProvider,
  type RenderProvider,
  type SandboxBaseArtifact,
} from "@/lib/video-engine/render-provider";
import { parseFfprobe, type ExpectedTechnicalSpec, type TechnicalQaResult } from "@/lib/video-engine/qa";
import { SupabaseVideoStoragePort, type StorageDbClient } from "@/lib/video-engine/storage-adapter.supabase";
import type { StoragePort } from "@/lib/video-engine/storage-port";
import { BASE_ARTIFACT_VERSION } from "@/lib/video-engine/versions";
import { listingVideoInputSchema } from "@/remotion/input";

// ---------------------------------------------------------------------------
// Sandbox base artifact — from env, never silently defaulted (requirement 8: no
// npm-install-per-render fallback to a stock, unprepared runtime).
// ---------------------------------------------------------------------------

export class MissingSandboxBaseArtifactError extends Error {
  constructor() {
    super(
      "worker-deps: no Sandbox base artifact configured — set CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID " +
        "or CREATIVE_STUDIO_SANDBOX_IMAGE before the worker can render for real (owner action — see " +
        "the production-readiness checklist)",
    );
    this.name = "MissingSandboxBaseArtifactError";
  }
}

export function resolveSandboxBaseArtifactFromEnv(): SandboxBaseArtifact {
  const snapshotId = process.env.CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID;
  if (snapshotId) return { snapshotId };
  const image = process.env.CREATIVE_STUDIO_SANDBOX_IMAGE;
  if (image) return { image };
  throw new MissingSandboxBaseArtifactError();
}

// ---------------------------------------------------------------------------
// Listing summary — the small slice of `properties` the composition needs.
// ---------------------------------------------------------------------------

export interface ListingSummary {
  addressLine: string;
  priceLabel: string;
}

interface PropertyRow {
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  list_price: number | null;
}

type PgError = { message?: string } | null;

// Same narrowing pattern as asset-store.supabase.ts / jobs-store.supabase.ts: go
// through `unknown` first so TS never structurally compares the real recursive
// PostgrestQueryBuilder type against this small hand-rolled interface (that comparison
// is what triggers TS2589).
interface PropertiesQueryBuilder extends PromiseLike<{ data: unknown; error: PgError }> {
  eq(col: string, val: string): PropertiesQueryBuilder;
  select(cols?: string): PropertiesQueryBuilder;
  maybeSingle(): PromiseLike<{ data: unknown; error: PgError }>;
}
interface PropertiesTable {
  select(cols?: string): PropertiesQueryBuilder;
}
function propertiesTable(client: SupabaseClient): PropertiesTable {
  return client.from("properties") as unknown as PropertiesTable;
}

function formatPriceLabel(listPrice: number | null): string {
  if (listPrice === null || !Number.isFinite(listPrice)) return "Price upon request";
  return `$${Math.round(listPrice).toLocaleString("en-US")}`;
}

function formatAddressLine(row: PropertyRow): string {
  const parts = [row.address_street, row.address_city, row.address_state, row.address_zip].filter(
    (p): p is string => Boolean(p && p.trim()),
  );
  return parts.length > 0 ? parts.join(", ") : "Listing";
}

export function defaultLoadListing(client: SupabaseClient): (listingId: string) => Promise<ListingSummary | null> {
  return async (listingId) => {
    const { data, error } = await propertiesTable(client)
      .select("address_street, address_city, address_state, address_zip, list_price")
      .eq("id", listingId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as PropertyRow;
    return { addressLine: formatAddressLine(row), priceLabel: formatPriceLabel(row.list_price) };
  };
}

// ---------------------------------------------------------------------------
// Downloading a source photo Asset to a specific local path via a short-lived signed
// URL — generated at job start (not baked into any client-facing payload; the
// manifest sent to the Sandbox, built by manifest.ts, never sees this URL — only the
// already-downloaded local bytes get staged in).
// ---------------------------------------------------------------------------

const DEFAULT_SOURCE_SIGNED_URL_TTL_SECONDS = 300; // sufficient TTL at job start (5 min)

export type DownloadAssetFn = (asset: Asset, destPath: string) => Promise<void>;

export function defaultDownloadAsset(
  client: StorageDbClient,
  opts: { ttlSeconds?: number; fetchImpl?: typeof fetch } = {},
): DownloadAssetFn {
  const ttl = opts.ttlSeconds ?? DEFAULT_SOURCE_SIGNED_URL_TTL_SECONDS;
  const fetchImpl = opts.fetchImpl ?? fetch;

  return async (asset, destPath) => {
    const { data, error } = await client.storage.from(asset.storageBucket).createSignedUrl(asset.storagePath, ttl);
    if (error || !data?.signedUrl) {
      throw new Error(`worker-deps: failed to sign source asset ${asset.id}: ${error?.message ?? "no signed url"}`);
    }
    const res = await fetchImpl(data.signedUrl);
    if (!res.ok) {
      throw new Error(`worker-deps: failed to download source asset ${asset.id}: HTTP ${res.status}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) {
      throw new Error(`worker-deps: downloaded source asset ${asset.id} is empty`);
    }
    await writeFile(destPath, bytes);
  };
}

// Deterministic, order-preserving local temp path for one source Asset — computed
// BEFORE any download happens, so it can be embedded verbatim into `inputProps.photos[].url`
// (SandboxRemotionProvider's `rewriteLocalPathsToRemote` finds/replaces this exact
// string later) while ALSO being exactly what `downloadAssets` writes to.
function extFor(asset: Asset): string {
  const fromPath = path.extname(asset.storagePath);
  if (fromPath) return fromPath;
  if (asset.mime === "image/png") return ".png";
  if (asset.mime === "image/webp") return ".webp";
  return ".jpg";
}
function localPathFor(tempDir: string, index: number, asset: Asset): string {
  return path.join(tempDir, `photo-${index}${extFor(asset)}`);
}

// ---------------------------------------------------------------------------
// Technical QA — parses the ffprobe JSON the render Sandbox already captured
// (render-provider.ts's `RenderMediaOutput.ffprobeJson`). No host ffprobe spawn: this
// is pure JSON parsing + the existing pure `parseFfprobe` (qa.ts), nothing more.
// ---------------------------------------------------------------------------

export async function defaultRunQa(
  ffprobeJson: string,
  bytes: Buffer,
  expected: ExpectedTechnicalSpec,
): Promise<TechnicalQaResult> {
  return parseFfprobe(JSON.parse(ffprobeJson), expected, bytes);
}

// ---------------------------------------------------------------------------
// `produce` — resolves listing + source photo Assets, builds a validated `inputProps`,
// downloads photos to deterministic local paths, and calls the already-validated
// `produceVideoAsset` with a fully real deps set.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Source-photo Assets. Sellers only ever create `property_photos` rows; the engine
// consumes `assets` (kind=photo) via selectForCapability. Nothing wired these two
// together, so a real listing had ZERO source Assets and the worker threw
// "no source photo Assets". We wrap them on demand here (the design's lazy §7/§9.2
// wrapping), just before the engine selects — idempotent via the store's
// (source_type, source_id) uniqueness. `property_photos` stores only a public URL, so
// the storage bucket/path each Asset needs is derived from that URL.
// ---------------------------------------------------------------------------

// `.../storage/v1/object/{public|sign}/<bucket>/<path>[?query]` -> { bucket, path }.
// Returns null for anything that isn't a Supabase storage object URL (skipped, not fatal).
export function parseStoragePublicUrl(url: string): { bucket: string; path: string } | null {
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/);
  if (!m) return null;
  return { bucket: m[1], path: m[2] };
}

// Wraps each of a listing's property_photos into a kind=photo Asset (idempotent).
// Exported for unit tests; the DB-backed loader is defaultEnsurePhotoAssets below.
export async function ensureListingPhotoAssets(
  assets: AssetStore,
  photos: { id: string; url: string }[],
  listingId: string,
  ownerId: string,
): Promise<void> {
  for (const photo of photos) {
    const ref = parseStoragePublicUrl(photo.url);
    if (!ref) continue; // unparseable URL — can't stage it as a source Asset, skip
    await wrapPropertyPhoto(assets, {
      photo: { id: photo.id, url: photo.url, bucket: ref.bucket, path: ref.path },
      listingId,
      ownerId,
    });
  }
}

// Real wiring: load the listing's property_photos and wrap them. Ordered by
// display_order so the video's photo sequence matches the seller's gallery order.
export function defaultEnsurePhotoAssets(
  client: SupabaseClient,
  assets: AssetStore,
): (listingId: string, ownerId: string) => Promise<void> {
  return async (listingId, ownerId) => {
    const { data, error } = await client
      .from("property_photos")
      .select("id, url")
      .eq("property_id", listingId)
      .order("display_order", { ascending: true });
    if (error) throw new Error(`worker-deps: failed to load property_photos for ${listingId}: ${error.message}`);
    const photos = (data ?? []).filter((r): r is { id: string; url: string } => Boolean(r?.id && r?.url));
    await ensureListingPhotoAssets(assets, photos, listingId, ownerId);
  };
}

const DEFAULT_BRAND_NAME = "Lixtara";
const DEFAULT_CTA_TEXT = "See more at lixtara.com";

export interface WorkerDepsOptions {
  assets?: AssetStore;
  storage?: StoragePort;
  render?: RenderProvider;
  runQa?: ProduceVideoAssetDeps["runQa"];
  loadListing?: (listingId: string) => Promise<ListingSummary | null>;
  downloadAsset?: DownloadAssetFn;
  ensurePhotoAssets?: (listingId: string, ownerId: string) => Promise<void>;
  now?: () => number;
  brandName?: string;
  ctaText?: string;
  tempDirPrefix?: string;
}

interface ResolvedWorkerDeps {
  assets: AssetStore;
  storage: StoragePort;
  render: RenderProvider;
  runQa: ProduceVideoAssetDeps["runQa"];
  loadListing: (listingId: string) => Promise<ListingSummary | null>;
  downloadAsset: DownloadAssetFn;
  // Optional so buildRealProduce's many unit tests (which seed the AssetStore directly)
  // stay untouched; the real wiring below always supplies defaultEnsurePhotoAssets.
  ensurePhotoAssets?: (listingId: string, ownerId: string) => Promise<void>;
  now: () => number;
  brandName: string;
  ctaText: string;
  tempDirPrefix: string;
}

// Builds `PipelineDeps["produce"]` against an EXPLICIT, fully-resolved deps set — every
// unit test in worker-deps.test.ts calls this directly with fakes (FakeRenderProvider,
// an in-memory AssetStore/StoragePort, a fake loadListing/downloadAsset). No real
// Supabase/Sandbox/ffprobe is ever touched by this function in isolation.
export function buildRealProduce(deps: ResolvedWorkerDeps): PipelineDeps["produce"] {
  return async (
    input: { jobId: string; listingId: string; ownerId: string; traceId: string | null },
    hooks: { onStage: OnStageHook },
  ) => {
    const listing = await deps.loadListing(input.listingId);
    if (!listing) {
      throw new Error(`worker-deps: listing not found for produce: ${input.listingId}`);
    }

    // Sellers create property_photos, never Assets — wrap them into kind=photo source
    // Assets (idempotent) BEFORE selecting, or selectForCapability finds nothing.
    if (deps.ensurePhotoAssets) {
      await deps.ensurePhotoAssets(input.listingId, input.ownerId);
    }

    const sourceAssets = await selectForCapability(deps.assets, input.listingId, "video");
    if (sourceAssets.length === 0) {
      throw new Error(`worker-deps: no source photo Assets for listing ${input.listingId}`);
    }

    const tempDir = await mkdtemp(path.join(tmpdir(), deps.tempDirPrefix));
    try {
      const localPaths = sourceAssets.map((asset, i) => localPathFor(tempDir, i, asset));

      const inputProps = listingVideoInputSchema.parse({
        property: { addressLine: listing.addressLine },
        priceLabel: listing.priceLabel,
        photos: localPaths.map((url) => ({ url })),
        brand: { name: deps.brandName },
        cta: { text: deps.ctaText },
        badge: null,
      });

      // Wraps the deterministic paths computed above — the REAL download (and its
      // timing, for `assetDownloadMs`) happens here, inside what produceVideoAsset
      // calls as `deps.downloadAssets`, not before it.
      const downloadAssets = async (assetsToDownload: Asset[]): Promise<string[]> => {
        for (let i = 0; i < assetsToDownload.length; i++) {
          await deps.downloadAsset(assetsToDownload[i], localPaths[i]);
        }
        return localPaths;
      };

      return await produceVideoAsset(
        {
          listingId: input.listingId,
          ownerId: input.ownerId,
          sourceAssets,
          inputProps,
          traceId: input.traceId,
        },
        {
          render: deps.render,
          runQa: deps.runQa,
          storage: deps.storage,
          assets: deps.assets,
          downloadAssets,
          now: deps.now,
          onStage: hooks.onStage,
        },
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

// ---------------------------------------------------------------------------
// `reconcile` — adopts an already-persisted Asset for a retried job instead of
// re-rendering/re-uploading (see pipeline.ts's `fastForwardToCompleted`). Matches
// EITHER the job's own `assetId` (if a prior attempt already reached the `uploading`
// setState call that stamps it) OR a video Asset for this listing whose
// `provenance.traceId` equals the job's trace id (covers a prior attempt that uploaded
// + created the Asset but crashed before the job row itself was updated).
// ---------------------------------------------------------------------------

export function buildRealReconcile(assets: AssetStore): PipelineDeps["reconcile"] {
  return async (job: CreativeJob): Promise<ReconcileResult> => {
    if (job.assetId) {
      const existing = await assets.getById(job.assetId);
      if (existing) return { alreadyDone: true, asset: existing };
    }

    if (job.traceId) {
      const listingAssets = await assets.listByListing(job.listingId);
      const match = listingAssets.find(
        (a) =>
          a.kind === "video" &&
          (a.provenance as { traceId?: string | null } | null)?.traceId === job.traceId,
      );
      if (match) return { alreadyDone: true, asset: match };
    }

    return { alreadyDone: false };
  };
}

// ---------------------------------------------------------------------------
// Top-level real wiring — what worker/route.ts's `defaultRunDeps()` calls. Every field
// is overridable (used by worker-deps.test.ts to swap in fakes without touching
// `buildRealProduce`/`buildRealReconcile` signatures) but defaults to the real,
// Supabase/Sandbox/ffprobe-backed implementations above.
// ---------------------------------------------------------------------------

export function buildRealWorkerDeps(
  client: SupabaseClient,
  overrides: WorkerDepsOptions = {},
): { produce: PipelineDeps["produce"]; reconcile: PipelineDeps["reconcile"] } {
  const assets = overrides.assets ?? new SupabaseAssetStore(client);
  const storage = overrides.storage ?? new SupabaseVideoStoragePort(client);
  const render =
    overrides.render ??
    new SandboxRemotionProvider({
      baseArtifact: resolveSandboxBaseArtifactFromEnv(),
      baseArtifactVersion: BASE_ARTIFACT_VERSION,
    });
  const runQa = overrides.runQa ?? defaultRunQa;
  const loadListing = overrides.loadListing ?? defaultLoadListing(client);
  const downloadAsset = overrides.downloadAsset ?? defaultDownloadAsset(client as unknown as StorageDbClient);
  const ensurePhotoAssets = overrides.ensurePhotoAssets ?? defaultEnsurePhotoAssets(client, assets);
  const now = overrides.now ?? (() => Date.now());
  const brandName = overrides.brandName ?? DEFAULT_BRAND_NAME;
  const ctaText = overrides.ctaText ?? DEFAULT_CTA_TEXT;
  const tempDirPrefix = overrides.tempDirPrefix ?? "video-engine-src-";

  const resolved: ResolvedWorkerDeps = {
    assets,
    storage,
    render,
    runQa,
    loadListing,
    downloadAsset,
    ensurePhotoAssets,
    now,
    brandName,
    ctaText,
    tempDirPrefix,
  };

  return {
    produce: buildRealProduce(resolved),
    reconcile: buildRealReconcile(assets),
  };
}
