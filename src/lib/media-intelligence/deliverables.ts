// Turns the strategy's recommended outputs into concrete planned deliverables
// by asking each capability's specialist to plan. Deterministic.
import type { Deliverable, MediaStrategy } from "@/lib/media-intelligence/types";
import { getSpecialist } from "@/lib/media-intelligence/agents/registry";

export function planDeliverables(strategy: MediaStrategy): Deliverable[] {
  const capabilities = new Set(strategy.recommendedOutputs.map((o) => o.capability));
  const out: Deliverable[] = [];
  for (const capability of capabilities) {
    out.push(...getSpecialist(capability).plan(strategy));
  }
  return out;
}
