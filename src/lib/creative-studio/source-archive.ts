// F4.6 — Stage A: pure Archive contracts + executor. NO persistence, NO Supabase, NO SQL, NO
// lifecycle mutation, NO audit, NO migrations, NO runner. This module defines the domain shapes
// and a mechanical batch executor only. The write side is an abstract port (`ArchiveWriter`);
// its real implementation (a conditional UPDATE + audit) is Stage C and does not exist yet.
//
// ARCHITECTURAL PRINCIPLE (enforced by this module's shape):
//
//   Archive never makes decisions.
//   The executor only executes the plan produced by computeRetention (F4.5).
//   It never recomputes current, never re-orders, never generates candidates, never applies
//   heuristics. Every decision — which asset is current, which are orphans, in what order —
//   comes exclusively from the F4.5 engine and is handed to this executor as data.
//
// See docs/superpowers/plans/2026-07-23-f4.6-asset-archive-design.md.

// What happened to ONE archive attempt, as reported by an ArchiveWriter. These are OUTCOME
// LABELS (a contract for what the writer may return) — NOT lifecycle values and NOT the F4.5
// engine's "alreadyArchived" bucket (that is Stage B). Stage A never produces these itself; only
// a writer (faked in tests here; real in Stage C) does.
export type ArchiveOutcome =
  | "archived"
  | "already_archived"
  | "not_found_or_not_owner"
  | "skipped_current"
  | "error";

export const ARCHIVE_OUTCOMES: readonly ArchiveOutcome[] = [
  "archived",
  "already_archived",
  "not_found_or_not_owner",
  "skipped_current",
  "error",
] as const;

// Value object: data used EXCLUSIVELY by the audit event (activity_log metadata — design §5).
// Deliberately separated from the operational fields so the model states what the WHERE guards
// consume vs. what only the evidence record carries. It comes from the plan like everything
// else; the writer passes it through verbatim and never derives, re-reads, or interprets it.
export interface ArchiveAuditData {
  listingId: string; // audit denormalization (activity_log.property_id)
  prevLifecycle: string; // audit reversibility target — the orphan's lifecycle at classification
}

// One archive instruction for one Asset. Built verbatim from the F4.5 plan — never from the
// executor's own reasoning. `currentId` is the plan's current (the guard value); the executor
// passes it through and NEVER recomputes it. Operational fields (assetId/ownerId/currentId
// feed the conditional UPDATE's WHERE; reason/runId correlate the run) vs. `audit` (evidence
// only) are explicitly separated.
export interface ArchiveCommand {
  assetId: string;
  ownerId: string;
  currentId: string; // authority-supplied guard; the writer refuses to archive this id
  reason: string; // correlation: why this run archives
  runId: string; // correlation: which run
  audit: ArchiveAuditData; // audit-only payload — never consulted by the UPDATE's guards
}

// Per-Asset result. Independent of every other Asset (no batch rollback, no shared transaction).
export interface ArchiveResult {
  assetId: string;
  outcome: ArchiveOutcome;
  error?: string; // populated only when outcome === "error"
}

// The narrow write port. SINGLE responsibility: archive one Asset. This is deliberately NOT an
// AssetStore and gains no other methods.
export interface ArchiveWriter {
  archive(command: ArchiveCommand): Promise<ArchiveOutcome>;
}

// The already-computed plan for ONE listing, as produced by F4.5's computeListingRetention
// (resolved case). The executor consumes it verbatim: it archives exactly `orphanIds`, in this
// order, guarding every write with `currentId`. It never resolves current, sorts, filters, or
// invents candidates. (Mapping a ListingRetention → ListingArchivePlan is the runner's trivial
// job in Stage D; Stage A stays decoupled from the engine types.)
export interface ListingArchivePlan {
  listingId: string;
  ownerId: string;
  currentId: string; // from resolveVideoSource via the engine; NEVER recomputed here
  orphanIds: string[]; // exactly the engine's orphans, in the engine's order
  // Stage C: each orphan's lifecycle AT CLASSIFICATION (audit `prevLifecycle`). Supplied by the
  // plan builder (the Stage D runner holds the classified assets); the executor only threads it.
  prevLifecycleById: Record<string, string>;
}

export interface ArchiveRunOptions {
  reason: string;
  runId: string;
}

export interface ArchiveRunSummary {
  results: ArchiveResult[];
  counts: Record<ArchiveOutcome, number>;
}

function emptyCounts(): Record<ArchiveOutcome, number> {
  return { archived: 0, already_archived: 0, not_found_or_not_owner: 0, skipped_current: 0, error: 0 };
}

// Archive ONE Asset via the writer. TRANSPARENT: it returns the writer's outcome wrapped in a
// result and PROPAGATES any exception the writer throws (it does not catch or represent errors).
// Deciding how to represent a partial failure is the batch's responsibility, not the primitive's.
export async function archiveAsset(writer: ArchiveWriter, command: ArchiveCommand): Promise<ArchiveResult> {
  const outcome = await writer.archive(command);
  return { assetId: command.assetId, outcome };
}

// Batch executor. Executes a set of ALREADY-COMPUTED listing plans, in order. For each plan it
// archives exactly `orphanIds` — one independent, atomic-at-the-writer operation per Asset,
// guarded by that plan's `currentId`. It makes NO decisions: no current resolution, no sorting,
// no filtering, no candidate generation. The batch is the layer that decides how partial errors
// are represented: it CATCHES a thrown exception from an individual archive, records it as an
// `"error"` result, and keeps going (no rollback, no shared transaction).
export async function archiveAssets(
  writer: ArchiveWriter,
  plans: ListingArchivePlan[],
  options: ArchiveRunOptions,
): Promise<ArchiveRunSummary> {
  const results: ArchiveResult[] = [];
  for (const plan of plans) {
    for (const assetId of plan.orphanIds) {
      // Malformed plan (an orphan without its classification lifecycle) is a data error the
      // batch records — never a value the executor invents.
      const prevLifecycle = plan.prevLifecycleById[assetId];
      if (!prevLifecycle) {
        results.push({ assetId, outcome: "error", error: "plan_missing_prevLifecycle" });
        continue;
      }
      const command: ArchiveCommand = {
        assetId,
        ownerId: plan.ownerId,
        currentId: plan.currentId,
        reason: options.reason,
        runId: options.runId,
        audit: { listingId: plan.listingId, prevLifecycle },
      };
      try {
        results.push(await archiveAsset(writer, command));
      } catch (e) {
        results.push({ assetId, outcome: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  const counts = emptyCounts();
  for (const r of results) counts[r.outcome] += 1;
  return { results, counts };
}
