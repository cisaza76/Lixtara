// F4.5 (first stage) — READ-ONLY dry-run harness for Source Video retention/cleanup.
//
// Run:  pnpm tsx scripts/dry-run-source-retention.ts [--k=3] [--json]
//
// This harness performs ONLY read-only reads. It never archives, deletes, mutates a row,
// touches Storage, opens an endpoint, or schedules a cron. The analysis logic lives in the
// pure, unit-tested engine src/lib/creative-studio/source-retention.ts.
//
// Single-authority principle (ADR-0009): the SOLE authority for "which Source Video is current"
// is `defaultResolveVideoSource` (src/lib/video-engine/resolve-video-source.ts) — the same
// canonical function the render worker consumes. This harness CONSUMES it; it never reimplements
// or recomputes the selection rule.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createService } from "@/lib/supabase/service";
import { SupabaseAssetStore } from "@/lib/assets/asset-store.supabase";
import { defaultResolveVideoSource } from "@/lib/video-engine/resolve-video-source";
import {
  RETENTION_K,
  dedupUniverse,
  computeListingRetention,
  aggregateReport,
  formatReportSummary,
  type ListingKey,
  type ListingRetention,
} from "@/lib/creative-studio/source-retention";

// Minimal .env.local loader (mirrors scripts/check-docusign-template.ts).
try {
  const envText = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
} catch {
  /* env may already be present in the shell */
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

async function main(): Promise<void> {
  const k = Number(arg("k") ?? RETENTION_K);
  const asJson = process.argv.includes("--json");

  const client = createService();
  const store = new SupabaseAssetStore(client); // read-only usage: only listByListing() is called
  const resolveVideoSource = defaultResolveVideoSource(store); // ← canonical single authority (ADR-0009)

  // READ-ONLY universe projection: only (listing_id, owner_id) of eligible source assets are
  // needed to derive the (listingId, ownerId) universe + the eligible count.
  const { data, error } = await client
    .from("assets")
    .select("listing_id, owner_id")
    .eq("kind", "video")
    .eq("source_type", "seller_upload");
  if (error) throw new Error(`read-only universe query failed: ${error.message}`);

  const rows = (data as { listing_id: string; owner_id: string }[] | null) ?? [];
  const universe: ListingKey[] = dedupUniverse(rows.map((r) => ({ listingId: r.listing_id, ownerId: r.owner_id })));

  const results: ListingRetention[] = [];
  for (const key of universe) {
    const current = await resolveVideoSource(key.listingId, key.ownerId); // authority — consumed, not recomputed
    const listingAssets = await store.listByListing(key.listingId); // read-only
    results.push(computeListingRetention(key, current, listingAssets, k));
  }

  const report = aggregateReport(results, rows.length, k);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReportSummary(report));
    console.log("  (READ-ONLY — no archive, delete, mutation, or Storage access performed.)");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
