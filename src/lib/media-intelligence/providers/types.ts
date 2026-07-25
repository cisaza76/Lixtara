// The MediaGenerationProvider is the deliverable-level engine seam that
// specialists talk to. Capability sub-interfaces are structurally identical
// in v1 — they exist as explicit extension points for future engines.
import type {
  Deliverable,
  GenerationPrompt,
  MediaCapability,
  MediaStrategy,
  SelectedShot,
} from "@/lib/media-intelligence/types";

export interface MediaGenInput {
  capability: MediaCapability;
  strategy: MediaStrategy;
  shots: SelectedShot[];
  prompts: GenerationPrompt[];
  deliverable: Deliverable;
}

export interface GeneratedDeliverable {
  deliverableId: string;
  url: string | null; // null in mock — nothing real is produced in v1
  status: "mock" | "ready" | "failed";
  provider: string;
  detail?: string;
}

export interface MediaGenerationProvider {
  readonly id: string;
  readonly capabilities: readonly MediaCapability[];
  isConfigured(): boolean;
  generate(input: MediaGenInput): Promise<GeneratedDeliverable>;
}

// Capability-scoped extension seams (structurally identical in v1).
export type VideoProvider = MediaGenerationProvider;
export type ImageProvider = MediaGenerationProvider;
export type PresentationProvider = MediaGenerationProvider;
export type TourProvider = MediaGenerationProvider;
export type ThreeDProvider = MediaGenerationProvider;
export type VoiceProvider = MediaGenerationProvider;

export class ProviderNotConfiguredError extends Error {
  constructor(providerId: string, detail?: string) {
    super(`provider "${providerId}" is not configured${detail ? `: ${detail}` : ""}`);
    this.name = "ProviderNotConfiguredError";
  }
}
