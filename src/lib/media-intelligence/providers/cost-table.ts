// Deterministic, per-engine/per-capability cost estimates (USD, rough
// per-deliverable). These are PLACEHOLDER estimates for the strategy's
// budgeting — the single source of truth for any price shown in the UI.
// The LLM must never emit prices; it only recommends an engine.
import type { MediaCapability } from "@/lib/media-intelligence/types";

export const PROVIDER_COST_USD: Record<
  string,
  Partial<Record<MediaCapability, number>>
> = {
  mock: { video: 0, image: 0, presentation: 0, tour: 0, three_d: 0, voice: 0 },
  veo: { video: 0.4 },
  kling: { video: 0.28 },
  runway: { video: 0.5 },
  luma: { video: 0.35, image: 0.02 },
  higgsfield: { video: 0.45 },
  wan: { video: 0.2 },
};

export function estimateCostUsd(
  engine: string,
  capability: MediaCapability,
): number {
  return PROVIDER_COST_USD[engine]?.[capability] ?? 0;
}
