// Conservative, env-driven worker config for the Creative Video pipeline. Defaults are
// deliberately tight (one job per run, no concurrency) — a production tuning pass can
// widen these via env vars, but an unconfigured environment (local dev, a fresh deploy)
// never accidentally fans out.
//
// Each field is a getter, not a value snapshotted at module load: it re-reads
// `process.env` on every access. That lets tests flip env vars mid-suite and observe
// the change immediately, and lets a real deploy pick up an env change on next read
// without a process restart being load-bearing for correctness.

// Parses a positive integer from `process.env[name]`, falling back to `def` when the
// var is unset, non-numeric, or <= 0. Never throws.
export function intEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return def;
  return parsed;
}

export interface CreativeVideoConfig {
  readonly maxJobsPerRun: number;
  readonly maxConcurrency: number;
  readonly jobTimeoutMs: number;
  readonly heartbeatMs: number;
  readonly staleAfterMs: number;
  // Wall-clock budget for a single cron worker invocation (src/app/api/creative-studio/
  // video/worker/route.ts). Conservative default well under typical serverless function
  // limits — the worker stops CLAIMING new jobs once this is near-exhausted and leaves
  // the rest `queued` for the next run; it is not an infinite queue drain.
  readonly workerTimeBudgetMs: number;
}

export const creativeVideoConfig: CreativeVideoConfig = {
  get maxJobsPerRun() {
    return intEnv("CREATIVE_VIDEO_MAX_JOBS_PER_RUN", 1);
  },
  get maxConcurrency() {
    return intEnv("CREATIVE_VIDEO_MAX_CONCURRENCY", 1);
  },
  get jobTimeoutMs() {
    return intEnv("CREATIVE_VIDEO_JOB_TIMEOUT_MS", 600_000);
  },
  get heartbeatMs() {
    return intEnv("CREATIVE_VIDEO_HEARTBEAT_MS", 15_000);
  },
  get staleAfterMs() {
    return intEnv("CREATIVE_VIDEO_STALE_AFTER_MS", 120_000);
  },
  get workerTimeBudgetMs() {
    return intEnv("CREATIVE_VIDEO_WORKER_BUDGET_MS", 50_000);
  },
};
