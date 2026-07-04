// Core types for the Media Intelligence Agent. Format-agnostic by design:
// video is one MediaCapability among many. The LLM produces a "draft"
// strategy (no prices); deterministic code fills cost from the cost-table.
import { z } from "zod";

export const MEDIA_CAPABILITIES = [
  "video", "image", "presentation", "tour", "three_d", "voice",
] as const;
export type MediaCapability = (typeof MEDIA_CAPABILITIES)[number];

export const MEDIA_JOB_STATUSES = [
  "pending", "analyzing", "generating", "completed", "failed",
] as const;
export type MediaJobStatus = (typeof MEDIA_JOB_STATUSES)[number];

export const ROOM_TYPES = [
  "fachada", "sala", "cocina", "habitacion", "bano", "exterior",
  "amenity", "lote", "aerea", "plano", "render", "otro",
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export interface Asset {
  photoId: string;
  url: string;
  resolution?: { w: number; h: number };
}

export interface Classification {
  photoId: string;
  roomType: RoomType;
  tags: string[];
  confidence: number; // 0..1
}

export interface QualityScore {
  photoId: string;
  sharpness: number; // 0..1
  lighting: number; // 0..1
  framing: number; // 0..1
  overall: number; // 0..1
  duplicateOf?: string; // photoId of the better near-duplicate
}

export interface SelectedShot {
  photoId: string;
  order: number;
  roomType: RoomType;
  reason: string;
  suggestedMotion: string;
}

export interface RecommendedOutput {
  capability: MediaCapability;
  engine: string;
  estimatedCostUsd: number; // filled deterministically, NOT by the LLM
}

export interface MediaStrategy {
  targetAudience: string;
  buyerPersona: string;
  emotions: string[];
  highlightSpaces: string[];
  hideSpaces: string[];
  narrativeOrder: string[];
  visualStyle: string;
  recommendedPlatforms: Array<{ platform: string; rationale: string }>;
  recommendedDurationSec: number;
  recommendedOutputs: RecommendedOutput[];
  bestRoiCombination: string[];
  rationale: string;
}

// What the LLM returns: same shape MINUS estimatedCostUsd (deterministic later).
export const mediaStrategyDraftSchema = z.object({
  targetAudience: z.string(),
  buyerPersona: z.string(),
  emotions: z.array(z.string()),
  highlightSpaces: z.array(z.string()),
  hideSpaces: z.array(z.string()),
  narrativeOrder: z.array(z.string()),
  visualStyle: z.string(),
  recommendedPlatforms: z.array(
    z.object({ platform: z.string(), rationale: z.string() }),
  ),
  recommendedDurationSec: z.number(),
  recommendedOutputs: z.array(
    z.object({
      capability: z.enum(MEDIA_CAPABILITIES),
      engine: z.string(),
    }),
  ),
  bestRoiCombination: z.array(z.string()),
  rationale: z.string(),
});
export type MediaStrategyDraft = z.infer<typeof mediaStrategyDraftSchema>;

export interface GenerationPrompt {
  shotOrder: number;
  photoId: string;
  prompt: string;
  guardrails: string;
}

export interface Deliverable {
  id: string;
  capability: MediaCapability;
  kind: string; // e.g. "cinematic_horizontal", "vertical_reel", "teaser"
  aspect: string; // e.g. "16:9", "9:16", "1:1"
  platforms: string[];
  status: "planned" | "mock" | "approved";
  specialistId: string;
}

export const STRATEGY_SCHEMA_VERSION = 1 as const;

export interface StrategyPayload {
  schemaVersion: typeof STRATEGY_SCHEMA_VERSION;
  assets: Asset[];
  classifications: Classification[];
  scores: QualityScore[];
  selectedShots: SelectedShot[];
  mediaStrategy: MediaStrategy;
  generationPrompts: GenerationPrompt[];
  deliverables: Deliverable[];
  providersUsed: Partial<Record<MediaCapability, string>>;
}
