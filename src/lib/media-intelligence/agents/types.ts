// A MediaSpecialist turns the Media Strategy into concrete deliverables for its
// capability and executes them via a provider. Specialists do NOT re-decide
// strategy — they execute the plan the Media Intelligence Agent produced.
import type {
  Deliverable,
  MediaCapability,
  MediaStrategy,
} from "@/lib/media-intelligence/types";
import type {
  GeneratedDeliverable,
  MediaGenerationProvider,
} from "@/lib/media-intelligence/providers/types";

export interface MediaSpecialist {
  readonly id: string;
  readonly capability: MediaCapability;
  plan(strategy: MediaStrategy): Deliverable[];
  execute(
    deliverable: Deliverable,
    provider: MediaGenerationProvider,
  ): Promise<GeneratedDeliverable>;
}
