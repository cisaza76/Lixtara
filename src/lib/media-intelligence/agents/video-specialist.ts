// Reference specialist. Plans video deliverables from the strategy's
// recommended video outputs and executes them via the selected provider
// (MockProvider in v1).
import type { Deliverable, MediaStrategy } from "@/lib/media-intelligence/types";
import type {
  GeneratedDeliverable,
  MediaGenerationProvider,
} from "@/lib/media-intelligence/providers/types";
import type { MediaSpecialist } from "@/lib/media-intelligence/agents/types";

// The concrete video formats v1 plans. Deterministic — not model-driven.
const VIDEO_FORMATS: Array<Pick<Deliverable, "kind" | "aspect" | "platforms">> = [
  { kind: "cinematic_horizontal", aspect: "16:9", platforms: ["web", "youtube"] },
  { kind: "vertical_reel", aspect: "9:16", platforms: ["instagram", "tiktok"] },
  { kind: "teaser", aspect: "1:1", platforms: ["instagram", "facebook"] },
];

export class VideoSpecialist implements MediaSpecialist {
  readonly id = "video-specialist";
  readonly capability = "video" as const;

  plan(strategy: MediaStrategy): Deliverable[] {
    const wantsVideo = strategy.recommendedOutputs.some(
      (o) => o.capability === "video",
    );
    if (!wantsVideo) return [];
    return VIDEO_FORMATS.map((f) => ({
      id: `video-${f.kind}`,
      capability: "video" as const,
      kind: f.kind,
      aspect: f.aspect,
      platforms: f.platforms,
      status: "planned" as const,
      specialistId: this.id,
    }));
  }

  async execute(
    deliverable: Deliverable,
    provider: MediaGenerationProvider,
  ): Promise<GeneratedDeliverable> {
    return provider.generate({
      capability: this.capability,
      strategy: {} as never, // strategy not needed by the mock; real providers get it via agent
      shots: [],
      prompts: [],
      deliverable,
    });
  }
}
