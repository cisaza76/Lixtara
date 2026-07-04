// The Media Intelligence Agent orchestrator. Deterministic control flow; LLM
// work happens inside injected deps (loadAssets/classify/score/strategy) so the
// whole pipeline is unit-testable. Persistence + final status are handled by the
// caller (the route) — this returns the completed StrategyPayload or throws.
import { STRATEGY_SCHEMA_VERSION, type MediaCapability, type StrategyPayload } from "@/lib/media-intelligence/types";
import type { Asset, Classification, MediaStrategy, QualityScore } from "@/lib/media-intelligence/types";
import type { MediaJobStatus } from "@/lib/media-intelligence/types";
import type { ListingFacts } from "@/lib/media-intelligence/strategy";
import { selectHeroShots } from "@/lib/media-intelligence/select";
import { buildGenerationPrompts } from "@/lib/media-intelligence/prompts";
import { planDeliverables } from "@/lib/media-intelligence/deliverables";
import { getSpecialist } from "@/lib/media-intelligence/agents/registry";
import { selectProvider } from "@/lib/media-intelligence/providers";

export interface AgentDeps {
  loadAssets(propertyId: string): Promise<Asset[]>;
  classify(assets: Asset[]): Promise<Classification[]>;
  score(assets: Asset[]): Promise<QualityScore[]>;
  strategy(shots: ReturnType<typeof selectHeroShots>, classifications: Classification[], facts: ListingFacts): Promise<MediaStrategy>;
  listingFacts(propertyId: string): Promise<ListingFacts>;
  setStatus(jobId: string, status: MediaJobStatus): Promise<void>;
}

export interface RunInput {
  jobId: string;
  propertyId: string;
  ownerId: string;
}

function log(jobId: string, stage: string, msg: string) {
  console.log(`[media-agent] job=${jobId} stage=${stage} ${msg}`);
}

export async function runMediaAgent(
  input: RunInput,
  deps: AgentDeps,
): Promise<StrategyPayload> {
  const { jobId, propertyId } = input;

  await deps.setStatus(jobId, "analyzing");
  log(jobId, "ingest", "loading assets");
  const assets = await deps.loadAssets(propertyId);

  log(jobId, "classify", `classifying ${assets.length} assets`);
  const classifications = await deps.classify(assets);

  log(jobId, "quality", "scoring assets");
  const scores = await deps.score(assets);

  log(jobId, "select", "selecting hero shots");
  const selectedShots = selectHeroShots(assets, classifications, scores);

  log(jobId, "strategy", "building media strategy");
  const facts = await deps.listingFacts(propertyId);
  const mediaStrategy = await deps.strategy(selectedShots, classifications, facts);

  const generationPrompts = buildGenerationPrompts(selectedShots, mediaStrategy);
  const deliverables = planDeliverables(mediaStrategy);

  await deps.setStatus(jobId, "generating");
  log(jobId, "generate", `dispatching ${deliverables.length} deliverables (mock)`);
  const providersUsed: Partial<Record<MediaCapability, string>> = {};
  for (const deliverable of deliverables) {
    const specialist = getSpecialist(deliverable.capability);
    const provider = selectProvider(deliverable.capability); // mock in v1
    const result = await specialist.execute(deliverable, provider);
    deliverable.status = result.status === "mock" ? "mock" : "planned";
    providersUsed[deliverable.capability] = provider.id;
  }

  return {
    schemaVersion: STRATEGY_SCHEMA_VERSION,
    assets,
    classifications,
    scores,
    selectedShots,
    mediaStrategy,
    generationPrompts,
    deliverables,
    providersUsed,
  };
}
