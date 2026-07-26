// F4.6 Stage D — MANUAL Source Video archive runner (dry-run by default; --apply to write).
//
// Usage:
//   pnpm archive:source-retention                                  # dry-run over the whole universe
//   pnpm archive:source-retention -- --listing <id>                # dry-run scoped to one listing
//   pnpm archive:source-retention -- --apply --listing <id>        # ARCHIVE one listing's fresh orphans
//   pnpm archive:source-retention -- --apply --all --confirm-all   # ARCHIVE globally (double opt-in)
//   flags: --json · --run-id <value> · --reason <value>
//
// SAFE BY DEFAULT: without --apply this performs ONLY reads (no UPDATE, no activity_log, no
// Storage, no mutation of any kind). Apply is never inferred from env/CI. Archive is SOFT
// delete — bytes are marked archived (reclaimable by a future GC), never physically removed.
//
// Single-authority principle (ADR-0009): current = defaultResolveVideoSource (the same
// canonical function the render worker consumes); classification = computeListingRetention
// (F4.5); writes = SupabaseArchiveWriter (Stage C) executing EXACTLY the plan reported by the
// dry-run phase of this same invocation. This shell only wires adapters — every rule lives in
// the pure, unit-tested module src/lib/creative-studio/source-archive-run.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createService } from "@/lib/supabase/service";
import { SupabaseAssetStore } from "@/lib/assets/asset-store.supabase";
import { defaultResolveVideoSource } from "@/lib/video-engine/resolve-video-source";
import { SupabaseArchiveWriter, type ArchiveWriterClient } from "@/lib/creative-studio/source-archive.supabase";
import type { ListingKey } from "@/lib/creative-studio/source-retention";
import {
  parseArchiveArgs,
  runArchive,
  formatArchiveRunSummary,
  type ArchiveRunDeps,
} from "@/lib/creative-studio/source-archive-run";

// Minimal .env.local loader (mirrors scripts/dry-run-source-retention.ts).
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

async function main(): Promise<void> {
  const parsed = parseArchiveArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`archive:source-retention — ${parsed.error}`);
    process.exitCode = 1;
    return;
  }
  const config = parsed.config;

  // Config guard: abort BEFORE any client is constructed if the required env is missing.
  // (Never print the key itself.)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error(
      "archive:source-retention — missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SECRET_KEY (service key). No reads or writes were performed.",
    );
    process.exitCode = 1;
    return;
  }

  const client = createService();
  const store = new SupabaseAssetStore(client); // read-only usage: only listByListing()
  const deps: ArchiveRunDeps = {
    async loadUniverseRows(): Promise<ListingKey[]> {
      // READ-ONLY universe projection: one row per eligible source asset.
      const { data, error } = await client
        .from("assets")
        .select("listing_id, owner_id")
        .eq("kind", "video")
        .eq("source_type", "seller_upload");
      if (error) throw new Error(`read-only universe query failed: ${error.message}`);
      const rows = (data as { listing_id: string; owner_id: string }[] | null) ?? [];
      return rows.map((r) => ({ listingId: r.listing_id, ownerId: r.owner_id }));
    },
    listByListing: (listingId) => store.listByListing(listingId),
    resolveVideoSource: defaultResolveVideoSource(store), // ← canonical single authority (ADR-0009)
    writer: new SupabaseArchiveWriter(client as unknown as ArchiveWriterClient), // used ONLY with --apply
    now: () => new Date().toISOString(),
    generateRunId: () => `run-${randomUUID()}`,
    log: (line) => console.log(line),
  };

  try {
    const report = await runArchive(deps, config);
    if (config.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatArchiveRunSummary(report));
    }
    process.exitCode = report.exitCode;
  } catch (e) {
    // Plan-build (or writer-batch) failure: clear error, non-zero exit. Individual asset errors
    // never throw (the batch records them); reaching here means the run itself failed.
    console.error(`archive:source-retention — run failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

main();
