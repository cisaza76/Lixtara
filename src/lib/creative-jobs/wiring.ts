// Compile-time-only regression guard for the Creative Studio Supabase adapters
// (SupabaseAssetStore, SupabaseJobsStore) and Gate D1's real worker wiring
// (buildRealWorkerDeps). Nothing in the app imports this module, so it contributes
// nothing to the Next.js bundle — but `tsconfig.json`'s `include` picks up every `.ts`
// file, so `pnpm tsc --noEmit` (and `next build`'s own type-check pass) still
// type-checks it. That's the point: this function constructs each adapter against the
// REAL `createService()` return type — the exact thing production wiring does —
// instead of a hand-rolled fake or an `as never` escape hatch.
//
// If any adapter regresses to a shape that only "structurally" matches its old
// self-referential query-builder interface but doesn't actually accept the real
// Supabase client, this file fails to compile with TS2589 ("Type instantiation is
// excessively deep and possibly infinite") and CI catches it — see
// src/lib/assets/asset-store.supabase.ts / src/lib/creative-jobs/jobs-store.supabase.ts
// / src/lib/video-engine/worker-deps.ts for the narrowing pattern that keeps this
// passing.
//
// Exported (so it isn't flagged as an unused local) but deliberately never called from
// anywhere — calling it for real would require live Supabase env vars AND (for
// buildRealWorkerDeps specifically) a configured Sandbox base artifact, which throws at
// CALL time (see worker-deps.ts#resolveSandboxBaseArtifactFromEnv) — never at type-check
// time, so this stays safe to leave uncalled.
import { createService } from "@/lib/supabase/service";
import type { AssetStore } from "@/lib/assets/types";
import { SupabaseAssetStore } from "@/lib/assets/asset-store.supabase";
import type { JobsStore } from "@/lib/creative-jobs/jobs";
import { SupabaseJobsStore } from "@/lib/creative-jobs/jobs-store.supabase";
import { buildRealWorkerDeps } from "@/lib/video-engine/worker-deps";
import type { PipelineDeps } from "@/lib/video-engine/pipeline";

export function _typeOnlyAdapterWiringCheck_neverCallThis(): {
  assetStore: AssetStore;
  jobsStore: JobsStore;
  workerDeps: { produce: PipelineDeps["produce"]; reconcile: PipelineDeps["reconcile"] };
} {
  const assetStore: AssetStore = new SupabaseAssetStore(createService());
  const jobsStore: JobsStore = new SupabaseJobsStore(createService());
  const workerDeps = buildRealWorkerDeps(createService());
  return { assetStore, jobsStore, workerDeps };
}
