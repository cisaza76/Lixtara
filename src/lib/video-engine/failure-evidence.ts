// Issue #112 — the failure evidence pack. A per-run collector accumulates flow facts
// (strategy, source asset, sandbox identity, per-stage durations) so that when a job
// fails, the transition to `failed` persists a COMPLETE, SQL-queryable story in
// `creative_job_transitions.metadata.evidence` — no schema change (the column is
// already jsonb) and no dependence on ephemeral sandbox/Vercel logs.
//
// Doctrine (approved #112 non-regression requirement): nothing in this module ever
// throws. A broken collector degrades to LESS evidence, never to a changed pipeline
// outcome. All methods are try/catch-swallowed; the snapshot is always serializable.

export interface PreparationEvidence {
  executed?: boolean; // true = ffmpeg ran this attempt; false = reused/never reached
  fingerprint?: string;
  snapshotId?: string;
  sandboxId?: string;
  exitCode?: number;
  durationMs?: number;
  kind?: string; // VideoPreparationFailureKind when the failure came from preparation
}

export interface RenderEvidence {
  sandboxId?: string;
  region?: string;
  snapshotId?: string;
  baseArtifactVersion?: string;
}

// Detected values from a failed technical QA — the full TechnicalQaResult surface
// minus nothing: booleans alone ("colorRange": false) cannot tell an operator whether
// the stream was pc, unknown, or absent.
export type QaDetectedEvidence = Record<string, unknown>;

export interface FailureEvidence {
  observabilitySchemaVersion: 1;
  stage?: string;
  stageDurationsMs: Record<string, number>;
  strategy?: "photo_slideshow" | "uploaded_video";
  sourceAssetId?: string;
  preparation?: PreparationEvidence;
  render?: RenderEvidence;
  qaDetected?: QaDetectedEvidence;
  stderrTail?: string; // sanitized upstream; tail-preserved
  causeChain?: string[];
}

export type FailureEvidencePatch = Partial<Omit<FailureEvidence, "observabilitySchemaVersion" | "stageDurationsMs">>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export class FailureEvidenceCollector {
  private facts: FailureEvidence = { observabilitySchemaVersion: 1, stageDurationsMs: {} };
  private stageEnteredAtMs: number | null = null;

  constructor(private readonly now: () => number) {}

  private safeNow(): number | null {
    try {
      const n = this.now();
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  // Shallow merge per top-level key; one level deep for the known object-valued keys so
  // later facts (e.g. sandboxId) never clobber earlier ones (e.g. executed).
  record(patch: FailureEvidencePatch): void {
    try {
      if (!isPlainObject(patch)) return;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const existing = (this.facts as unknown as Record<string, unknown>)[key];
        if (isPlainObject(value) && isPlainObject(existing)) {
          (this.facts as unknown as Record<string, unknown>)[key] = { ...existing, ...value };
        } else {
          (this.facts as unknown as Record<string, unknown>)[key] = value;
        }
      }
    } catch {
      // degrade to less evidence, never to a throw
    }
  }

  // Closes the previous stage's wall-clock duration and marks the new one in flight.
  observeStage(stage: string): void {
    try {
      const now = this.safeNow();
      const prev = this.facts.stage;
      if (prev && this.stageEnteredAtMs !== null && now !== null) {
        this.facts.stageDurationsMs[prev] = now - this.stageEnteredAtMs;
      }
      this.facts.stage = stage;
      this.stageEnteredAtMs = now;
    } catch {
      // ignore
    }
  }

  snapshot(opts?: { finalize?: boolean }): FailureEvidence {
    try {
      const copy: FailureEvidence = JSON.parse(JSON.stringify(this.facts));
      if (opts?.finalize && this.facts.stage && this.stageEnteredAtMs !== null) {
        const now = this.safeNow();
        if (now !== null) copy.stageDurationsMs[this.facts.stage] = now - this.stageEnteredAtMs;
      }
      return copy;
    } catch {
      return { observabilitySchemaVersion: 1, stageDurationsMs: {} };
    }
  }
}
