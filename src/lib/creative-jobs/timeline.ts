// Gate D1 ("Metrics / observability", docs/superpowers/plans/2026-07-15-creative-
// studio-p2-video.md, Task 7): an admin-only READ of one Creative Job's full technical
// transition timeline — durations, cost, provider, and the separated RenderMetrics that
// pipeline.ts's `processJob` stamps onto the final `completed` transition's `metadata`
// jsonb (never a job-level total). The `creative_job_transitions` table (append-only,
// service-client-write-only per RLS) IS the source of truth; this module does not
// duplicate or cache metrics anywhere else — it just reads and orders what's already
// persisted.
//
// Not itself an authorization boundary: this is a library-level read helper, not a
// route. The caller (an admin route/tool — none built in Gate D1, which is backend-
// only, no UI) is responsible for verifying the caller is actually an admin (e.g.
// `has_role('admin')`, per CLAUDE.md's Auth & RLS conventions) BEFORE calling this —
// `getJobTimeline` itself has no notion of "who is asking," only "which job."
import type { CreativeJob, JobsStore, StoredTransition } from "@/lib/creative-jobs/jobs";

export interface JobTimeline {
  job: CreativeJob;
  // Oldest -> newest. Each entry is a `StoredTransition` — includes `durationMs`,
  // `costUsd`/`costProvider`, `provider`, `attempt`, `errorCode`/`errorMessage`, and
  // `metadata` (which carries the separated RenderMetrics on the `completed` row).
  transitions: StoredTransition[];
}

function sortByTime(a: StoredTransition, b: StoredTransition): number {
  return a.at.localeCompare(b.at) || a.id.localeCompare(b.id);
}

// Returns `null` when the job itself doesn't exist — `store.getJob` is the ownership
// gate: a caller (an admin route/tool, per this module's header comment) can only ever
// get a timeline back for a `jobId` that resolves to a real job. Transitions are read
// job-id-scoped (`listTransitionsByJob`, mirrors `WHERE job_id = ? ORDER BY at`) rather
// than by pulling the owner's ENTIRE transition history into memory just to filter it
// down to one job. `sortByTime` stays as a defense-in-depth re-sort — this function's
// "oldest -> newest" contract must hold even if a `JobsStore` implementation's ordering
// guarantee is ever weaker than advertised.
export async function getJobTimeline(store: JobsStore, jobId: string): Promise<JobTimeline | null> {
  const job = await store.getJob(jobId);
  if (!job) return null;

  const transitions = (await store.listTransitionsByJob(jobId)).slice().sort(sortByTime);

  return { job, transitions };
}
