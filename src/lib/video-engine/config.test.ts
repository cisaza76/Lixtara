import { afterEach, describe, expect, it } from "vitest";

// Config is env-driven and parsed fresh on each access (a function/getter, not a
// module-scope constant) so tests can flip env and re-read without needing to reset
// the module registry between cases.
const ENV_KEYS = [
  "CREATIVE_VIDEO_MAX_JOBS_PER_RUN",
  "CREATIVE_VIDEO_MAX_CONCURRENCY",
  "CREATIVE_VIDEO_JOB_TIMEOUT_MS",
  "CREATIVE_VIDEO_HEARTBEAT_MS",
  "CREATIVE_VIDEO_STALE_AFTER_MS",
  "CREATIVE_VIDEO_WORKER_BUDGET_MS",
] as const;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  clearEnv();
});

describe("intEnv", () => {
  it("returns the default when the env var is unset", async () => {
    const { intEnv } = await import("@/lib/video-engine/config");
    delete process.env.SOME_UNSET_VAR;
    expect(intEnv("SOME_UNSET_VAR", 42)).toBe(42);
  });

  it("parses a valid positive integer from the env var", async () => {
    const { intEnv } = await import("@/lib/video-engine/config");
    process.env.SOME_TEST_VAR = "7";
    expect(intEnv("SOME_TEST_VAR", 42)).toBe(7);
    delete process.env.SOME_TEST_VAR;
  });

  it("falls back to the default on a non-numeric value", async () => {
    const { intEnv } = await import("@/lib/video-engine/config");
    process.env.SOME_TEST_VAR = "not-a-number";
    expect(intEnv("SOME_TEST_VAR", 42)).toBe(42);
    delete process.env.SOME_TEST_VAR;
  });

  it("falls back to the default on zero or a negative value", async () => {
    const { intEnv } = await import("@/lib/video-engine/config");
    process.env.SOME_TEST_VAR = "0";
    expect(intEnv("SOME_TEST_VAR", 42)).toBe(42);
    process.env.SOME_TEST_VAR = "-5";
    expect(intEnv("SOME_TEST_VAR", 42)).toBe(42);
    delete process.env.SOME_TEST_VAR;
  });
});

describe("creativeVideoConfig", () => {
  it("uses conservative defaults when no env vars are set", async () => {
    const { creativeVideoConfig } = await import("@/lib/video-engine/config");
    clearEnv();
    expect(creativeVideoConfig.maxJobsPerRun).toBe(1);
    expect(creativeVideoConfig.maxConcurrency).toBe(1);
    expect(creativeVideoConfig.jobTimeoutMs).toBe(600_000);
    expect(creativeVideoConfig.heartbeatMs).toBe(15_000);
    expect(creativeVideoConfig.staleAfterMs).toBe(120_000);
    expect(creativeVideoConfig.workerTimeBudgetMs).toBe(50_000);
  });

  it("reflects env overrides", async () => {
    const { creativeVideoConfig } = await import("@/lib/video-engine/config");
    process.env.CREATIVE_VIDEO_MAX_JOBS_PER_RUN = "5";
    process.env.CREATIVE_VIDEO_MAX_CONCURRENCY = "3";
    process.env.CREATIVE_VIDEO_JOB_TIMEOUT_MS = "120000";
    process.env.CREATIVE_VIDEO_HEARTBEAT_MS = "5000";
    process.env.CREATIVE_VIDEO_STALE_AFTER_MS = "30000";
    process.env.CREATIVE_VIDEO_WORKER_BUDGET_MS = "45000";

    expect(creativeVideoConfig.maxJobsPerRun).toBe(5);
    expect(creativeVideoConfig.maxConcurrency).toBe(3);
    expect(creativeVideoConfig.jobTimeoutMs).toBe(120_000);
    expect(creativeVideoConfig.heartbeatMs).toBe(5_000);
    expect(creativeVideoConfig.staleAfterMs).toBe(30_000);
    expect(creativeVideoConfig.workerTimeBudgetMs).toBe(45_000);
  });

  it("falls back to defaults per-field when an override is invalid", async () => {
    const { creativeVideoConfig } = await import("@/lib/video-engine/config");
    process.env.CREATIVE_VIDEO_MAX_JOBS_PER_RUN = "not-a-number";
    process.env.CREATIVE_VIDEO_MAX_CONCURRENCY = "-1";
    expect(creativeVideoConfig.maxJobsPerRun).toBe(1);
    expect(creativeVideoConfig.maxConcurrency).toBe(1);
  });
});
