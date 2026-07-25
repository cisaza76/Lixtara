// Deterministic per-shot prompts. Mirrors the guardrail philosophy of
// LIVING_LISTING_PROMPT (src/lib/tour/processors/gemini-video.ts): the real
// photo is the source of truth; the model must not invent geometry.
import type {
  GenerationPrompt,
  MediaStrategy,
  SelectedShot,
} from "@/lib/media-intelligence/types";

export const GEOMETRY_GUARDRAILS = [
  "The uploaded photo is the SOURCE OF TRUTH.",
  "Do NOT add, remove, or move walls, rooms, windows, doors, or fixtures.",
  "Do NOT add furniture or decor. Do NOT reveal anything outside the framing.",
  "Preserve the exact layout, materials, lighting, colors, and proportions.",
  "No people, no text, no logos, no watermarks. If in doubt, move the camera less.",
].join(" ");

export function buildGenerationPrompts(
  shots: SelectedShot[],
  strategy: MediaStrategy,
): GenerationPrompt[] {
  return shots.map((shot) => ({
    shotOrder: shot.order,
    photoId: shot.photoId,
    prompt: [
      `Subtle cinematic real-estate micro-clip of the ${shot.roomType}.`,
      `Camera: ${shot.suggestedMotion}. Mood: ${strategy.visualStyle}.`,
      `The uploaded photo is the SOURCE OF TRUTH — faithful and photorealistic.`,
    ].join(" "),
    guardrails: GEOMETRY_GUARDRAILS,
  }));
}
