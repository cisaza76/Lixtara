// Adapter that will delegate real video generation to the existing
// TourProcessor/Veo engine (src/lib/tour/). Registered so selectProvider() can
// find it, but NOT live in v1 — real generation lands in slice C. Kept honest:
// it throws rather than pretending to produce a video.
import {
  ProviderNotConfiguredError,
  type GeneratedDeliverable,
  type MediaGenInput,
  type VideoProvider,
} from "@/lib/media-intelligence/providers/types";
import type { MediaCapability } from "@/lib/media-intelligence/types";

export class VeoVideoProvider implements VideoProvider {
  readonly id = "veo";
  readonly capabilities: readonly MediaCapability[] = ["video"];
  isConfigured(): boolean {
    // A real GEMINI_API_KEY is necessary but not sufficient — the composition
    // path (slice C) isn't built yet, so treat as not-live in v1.
    return false;
  }
  async generate(_input: MediaGenInput): Promise<GeneratedDeliverable> {
    throw new ProviderNotConfiguredError(
      this.id,
      "Veo composition path lands in the generation slice (C)",
    );
  }
}
