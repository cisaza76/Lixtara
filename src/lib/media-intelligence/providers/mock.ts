// Always-available provider that stands in for real generation in v1.
// Produces a "mock" deliverable (no url) so the whole pipeline runs end-to-end
// with zero external spend and zero misrepresentation risk.
import { MEDIA_CAPABILITIES } from "@/lib/media-intelligence/types";
import type {
  GeneratedDeliverable,
  MediaGenInput,
  MediaGenerationProvider,
} from "@/lib/media-intelligence/providers/types";

export class MockProvider implements MediaGenerationProvider {
  readonly id = "mock";
  readonly capabilities = MEDIA_CAPABILITIES;
  isConfigured(): boolean {
    return true;
  }
  async generate(input: MediaGenInput): Promise<GeneratedDeliverable> {
    return {
      deliverableId: input.deliverable.id,
      url: null,
      status: "mock",
      provider: this.id,
      detail: "mock render — real generation lands in a later slice",
    };
  }
}
