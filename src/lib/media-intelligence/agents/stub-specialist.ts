// Factory for capabilities without a bespoke specialist yet. Plans one planned
// deliverable per recommended output of its capability; executes via provider
// (mock in v1). Never throws.
import type {
  Deliverable,
  MediaCapability,
  MediaStrategy,
} from "@/lib/media-intelligence/types";
import type {
  GeneratedDeliverable,
  MediaGenerationProvider,
} from "@/lib/media-intelligence/providers/types";
import type { MediaSpecialist } from "@/lib/media-intelligence/agents/types";

export function makeStubSpecialist(capability: MediaCapability): MediaSpecialist {
  return {
    id: `${capability}-specialist-stub`,
    capability,
    plan(strategy: MediaStrategy): Deliverable[] {
      return strategy.recommendedOutputs
        .filter((o) => o.capability === capability)
        .map((_o, i) => ({
          id: `${capability}-${i}`,
          capability,
          kind: `${capability}_default`,
          aspect: "n/a",
          platforms: [],
          status: "planned" as const,
          specialistId: `${capability}-specialist-stub`,
        }));
    },
    async execute(
      deliverable: Deliverable,
      provider: MediaGenerationProvider,
    ): Promise<GeneratedDeliverable> {
      return provider.generate({
        capability,
        strategy: {} as never,
        shots: [],
        prompts: [],
        deliverable,
      });
    },
  };
}
