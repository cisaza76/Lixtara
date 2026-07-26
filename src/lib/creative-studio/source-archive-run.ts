// F4.6 Stage D — the MANUAL archive runner's pure core: flag parsing, orchestration, and
// reporting. Dependency-injected (no Supabase, no env, no process here) so every safety rule is
// unit-testable; the thin shell (scripts/archive-source-retention.ts) wires real adapters.
//
// SAFETY MODEL (mandate):
// - Safe by default: no flags → dry-run. Mutation requires the EXPLICIT `--apply` flag — never
//   inferred from env vars, never auto-enabled anywhere.
// - `--apply` demands explicit scope: `--listing <id>` XOR `--all`; global apply additionally
//   demands `--confirm-all`. Validation failures abort BEFORE any dependency is touched.
// - Single authority: current comes from the injected resolveVideoSource, consumed verbatim by
//   computeListingRetention (F4.5). The runner never selects, corrects, or re-orders.
// - Same plan for both modes: apply executes EXACTLY the plan dry-run reports — one
//   classification path; the only difference is the final archiveAssets call.
// - Archive is SOFT delete: bytes are "marked archived / reclaimable by future GC" — never
//   reported as physically deleted.
import type { Asset } from "@/lib/assets/types";
import {
  RETENTION_K,
  computeListingRetention,
  dedupUniverse,
  type ListingKey,
  type ListingRetention,
} from "@/lib/creative-studio/source-retention";
import {
  archiveAssets,
  type ArchiveOutcome,
  type ArchiveWriter,
  type ListingArchivePlan,
} from "@/lib/creative-studio/source-archive";

export const DEFAULT_ARCHIVE_REASON = "source_retention_manual";

export type ArchiveScope = { kind: "all" } | { kind: "listing"; listingId: string };

export interface ArchiveRunConfig {
  mode: "dry-run" | "apply";
  scope: ArchiveScope;
  runId: string | null; // null → deps.generateRunId()
  reason: string;
  json: boolean;
}

export type ParseResult = { ok: true; config: ArchiveRunConfig } | { ok: false; error: string };

// Flag grammar: boolean flags (--apply, --all, --confirm-all, --json) and valued flags
// (--listing, --run-id, --reason) in either `--name=value` or `--name value` form. Unknown
// arguments are rejected — a typo must never silently degrade to a different mode.
export function parseArchiveArgs(argv: string[]): ParseResult {
  let apply = false;
  let all = false;
  let confirmAll = false;
  let json = false;
  let listing: string | null = null;
  let runId: string | null = null;
  let reason: string | null = null;

  const valued: Record<string, (v: string) => void> = {
    "--listing": (v) => (listing = v),
    "--run-id": (v) => (runId = v),
    "--reason": (v) => (reason = v),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue; // pnpm forwards the conventional separator verbatim — skip it
    if (arg === "--apply") apply = true;
    else if (arg === "--all") all = true;
    else if (arg === "--confirm-all") confirmAll = true;
    else if (arg === "--json") json = true;
    else {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg : arg.slice(0, eq);
      const setter = valued[name];
      if (!setter) return { ok: false, error: `unknown argument: ${arg}` };
      let value: string | undefined;
      if (eq !== -1) value = arg.slice(eq + 1);
      else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          value = next;
          i++;
        }
      }
      if (value === undefined || value.trim() === "") {
        return { ok: false, error: `${name} requires a non-empty value` };
      }
      setter(value.trim());
    }
  }

  if (listing !== null && all) return { ok: false, error: "--listing and --all are mutually exclusive" };
  if (confirmAll && !all) return { ok: false, error: "--confirm-all only applies together with --all" };
  if (apply && listing === null && !all) {
    return {
      ok: false,
      error:
        "apply requires an explicit scope: --listing <listingId> or --all (global apply additionally requires --confirm-all). No writes were performed.",
    };
  }
  if (apply && all && !confirmAll) {
    return {
      ok: false,
      error:
        "global apply requires explicit confirmation. Required command: pnpm archive:source-retention -- --apply --all --confirm-all. No writes were performed.",
    };
  }

  return {
    ok: true,
    config: {
      mode: apply ? "apply" : "dry-run",
      scope: listing !== null ? { kind: "listing", listingId: listing } : { kind: "all" },
      runId,
      reason: reason ?? DEFAULT_ARCHIVE_REASON,
      json,
    },
  };
}

// READ-ONLY dependencies + the write port (used exclusively in apply mode) + effect seams.
export interface ArchiveRunDeps {
  loadUniverseRows(): Promise<ListingKey[]>; // one entry per eligible source asset (pre-dedup)
  listByListing(listingId: string): Promise<Asset[]>;
  resolveVideoSource(listingId: string, ownerId: string): Promise<Asset | null>; // SOLE authority
  writer: ArchiveWriter; // consulted ONLY when mode === "apply"
  now(): string; // ISO timestamps (startedAt / finishedAt)
  generateRunId(): string;
  log(line: string): void; // human output — the pre-apply banner is emitted BEFORE any write
}

export interface ArchiveRunReport {
  mode: "dry-run" | "apply";
  runId: string;
  reason: string;
  scope: string; // "all" | "listing:<id>"
  k: number;
  startedAt: string;
  finishedAt: string;
  totals: {
    listingsExamined: number;
    listingsResolved: number;
    listingsUnresolved: number;
    currentAssets: number;
    retained: number;
    freshOrphans: number;
    alreadyArchived: number;
    reclaimableBytes: number;
    commandsPlanned: number;
  };
  listings: ListingRetention[]; // full engine detail, deterministic order (listingId ASC)
  apply: {
    counts: Record<ArchiveOutcome, number>;
    errors: { assetId: string; error: string }[];
  } | null; // null in dry-run — NOTHING was executed
  exitCode: 0 | 1;
  errorMessage?: string;
}

const scopeLabel = (s: ArchiveScope): string => (s.kind === "all" ? "all" : `listing:${s.listingId}`);

function errorReport(config: ArchiveRunConfig, runId: string, ts: string, message: string): ArchiveRunReport {
  return {
    mode: config.mode,
    runId,
    reason: config.reason,
    scope: scopeLabel(config.scope),
    k: RETENTION_K,
    startedAt: ts,
    finishedAt: ts,
    totals: {
      listingsExamined: 0,
      listingsResolved: 0,
      listingsUnresolved: 0,
      currentAssets: 0,
      retained: 0,
      freshOrphans: 0,
      alreadyArchived: 0,
      reclaimableBytes: 0,
      commandsPlanned: 0,
    },
    listings: [],
    apply: null,
    exitCode: 1,
    errorMessage: message,
  };
}

export async function runArchive(deps: ArchiveRunDeps, config: ArchiveRunConfig): Promise<ArchiveRunReport> {
  const startedAt = deps.now();
  const runId = (config.runId ?? deps.generateRunId()).trim();
  if (runId === "") return errorReport(config, runId, startedAt, "runId must be non-empty");
  if (config.reason.trim() === "") return errorReport(config, runId, startedAt, "reason must be non-empty");

  // Universe: derived EXCLUSIVELY from existing eligible source assets, deduped + sorted
  // deterministically (listingId ASC — dedupUniverse's order). Scope filters, never expands.
  const rows = await deps.loadUniverseRows();
  const universe = dedupUniverse(rows);
  const scoped =
    config.scope.kind === "listing"
      ? universe.filter((u) => config.scope.kind === "listing" && u.listingId === config.scope.listingId)
      : universe;

  if (config.scope.kind === "listing" && scoped.length === 0) {
    return errorReport(
      config,
      runId,
      startedAt,
      `listing ${config.scope.listingId} has no eligible Source Video assets (not found in the universe). No writes were performed.`,
    );
  }

  // ONE classification path for both modes: authority first, engine second, verbatim.
  const results: ListingRetention[] = [];
  const plans: ListingArchivePlan[] = [];
  for (const key of scoped) {
    const current = await deps.resolveVideoSource(key.listingId, key.ownerId); // the authority
    const listingAssets = await deps.listByListing(key.listingId);
    const retention = computeListingRetention(key, current, listingAssets, RETENTION_K);
    results.push(retention);
    if (retention.kind === "resolved" && retention.orphans.length > 0) {
      // Plan = EXACTLY the engine's fresh orphans, in the engine's order. current / retained /
      // alreadyArchived / unresolved NEVER become commands. prevLifecycle comes from the
      // classified assets the runner already holds — never invented (Stage C errors if absent).
      const lifecycleById = new Map(listingAssets.map((a) => [a.id, a.lifecycle as string]));
      const prevLifecycleById: Record<string, string> = {};
      for (const o of retention.orphans) {
        const lc = lifecycleById.get(o.id);
        if (lc !== undefined) prevLifecycleById[o.id] = lc;
      }
      plans.push({
        listingId: retention.listingId,
        ownerId: retention.ownerId,
        currentId: retention.current.id,
        orphanIds: retention.orphans.map((o) => o.id),
        prevLifecycleById,
      });
    }
  }

  const resolved = results.filter((r): r is Extract<ListingRetention, { kind: "resolved" }> => r.kind === "resolved");
  const unresolved = results.filter((r) => r.kind === "unresolvedCurrent");
  const totals = {
    listingsExamined: scoped.length,
    listingsResolved: resolved.length,
    listingsUnresolved: unresolved.length,
    currentAssets: resolved.length,
    retained: resolved.reduce((s, r) => s + r.retained.length, 0),
    freshOrphans: resolved.reduce((s, r) => s + r.orphans.length, 0),
    alreadyArchived: resolved.reduce((s, r) => s + r.alreadyArchived.length, 0),
    reclaimableBytes: resolved.reduce((s, r) => s + r.reclaimableBytes, 0),
    commandsPlanned: plans.reduce((s, p) => s + p.orphanIds.length, 0),
  };

  // --listing scope: an unresolved requested listing is a non-success result, zero mutations.
  if (config.scope.kind === "listing" && unresolved.length > 0) {
    const finishedAt = deps.now();
    return {
      mode: config.mode,
      runId,
      reason: config.reason,
      scope: scopeLabel(config.scope),
      k: RETENTION_K,
      startedAt,
      finishedAt,
      totals,
      listings: results,
      apply: null,
      exitCode: 1,
      errorMessage: `listing ${config.scope.listingId} is unresolvedCurrent (resolveVideoSource returned null) — investigate before archiving. No writes were performed.`,
    };
  }

  let apply: ArchiveRunReport["apply"] = null;
  if (config.mode === "apply") {
    // Pre-write banner — printed BEFORE any write is attempted.
    deps.log("APPLY MODE — ARCHIVE WRITES ENABLED");
    deps.log(`  scope: ${scopeLabel(config.scope)}`);
    deps.log(`  listings with commands: ${plans.length} of ${totals.listingsExamined} examined`);
    deps.log(`  assets planned: ${totals.commandsPlanned}`);
    deps.log(`  estimated bytes to mark archived (reclaimable by future GC): ${totals.reclaimableBytes}`);
    deps.log(`  runId: ${runId}`);
    const summary = await archiveAssets(deps.writer, plans, { reason: config.reason, runId });
    apply = {
      counts: summary.counts,
      errors: summary.results
        .filter((r) => r.outcome === "error")
        .map((r) => ({ assetId: r.assetId, error: r.error ?? "unknown" })),
    };
  }

  const finishedAt = deps.now();
  // already_archived is an IDEMPOTENT outcome, never a global error; only real errors fail.
  const exitCode: 0 | 1 = apply !== null && apply.counts.error > 0 ? 1 : 0;
  return {
    mode: config.mode,
    runId,
    reason: config.reason,
    scope: scopeLabel(config.scope),
    k: RETENTION_K,
    startedAt,
    finishedAt,
    totals,
    listings: results,
    apply,
    exitCode,
    ...(exitCode === 1 ? { errorMessage: "one or more assets failed to archive (see apply.errors)" } : {}),
  };
}

// Human-readable summary — a pure function of the report. Soft-delete language ONLY:
// "marked archived / reclaimable by future GC", never "deleted" or "storage reclaimed".
export function formatArchiveRunSummary(r: ArchiveRunReport): string {
  const lines: string[] = [];
  lines.push(r.mode === "apply" ? "APPLY MODE — ARCHIVE WRITES ENABLED" : "DRY RUN — NO CHANGES MADE");
  lines.push(`  runId: ${r.runId} · reason: ${r.reason} · scope: ${r.scope} · K=${r.k}`);
  lines.push(
    `  Listings: ${r.totals.listingsExamined} examined · ${r.totals.listingsResolved} resolved · ${r.totals.listingsUnresolved} unresolved`,
  );
  lines.push(
    `  Assets: ${r.totals.currentAssets} current · ${r.totals.retained} retained · ${r.totals.freshOrphans} fresh orphan(s) · ${r.totals.alreadyArchived} already archived (prior runs)`,
  );
  lines.push(
    `  Planned: ${r.totals.commandsPlanned} command(s) · ${r.totals.reclaimableBytes} bytes to mark archived (reclaimable by future GC — soft delete, nothing is physically removed)`,
  );
  if (r.apply) {
    const c = r.apply.counts;
    lines.push(
      `  Applied: ${c.archived} archived · ${c.already_archived} already_archived · ${c.skipped_current} skipped_current · ${c.not_found_or_not_owner} not_found_or_not_owner · ${c.error} error(s)`,
    );
    for (const e of r.apply.errors) lines.push(`    error: ${e.assetId} — ${e.error}`);
  }
  if (r.errorMessage) lines.push(`  ERROR: ${r.errorMessage}`);
  lines.push(`  exit: ${r.exitCode}`);
  return lines.join("\n");
}
