// LLM node: score each photo's sharpness/lighting/framing and flag near-dupes.
//
// EXTENSION POINT: v1 uses Claude Vision for perceptual scores. To swap in
// deterministic CV later (sharp/Laplacian variance for sharpness, perceptual
// hashing for duplicateOf), replace the body of scoreAssets — the signature and
// the QualityScore return shape are the stable contract callers depend on.
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Asset, QualityScore } from "@/lib/media-intelligence/types";
import type { ObjectGenerator } from "@/lib/media-intelligence/classify";

const MODEL = "claude-sonnet-4-6";

export const QUALITY_EXTENSION_POINT =
  "Replace scoreAssets() with deterministic CV (sharp/Laplacian + perceptual hash) here.";

const scoresSchema = z.object({
  scores: z.array(
    z.object({
      photoId: z.string(),
      sharpness: z.number(),
      lighting: z.number(),
      framing: z.number(),
      duplicateOf: z.string().nullable(),
    }),
  ),
});

export async function scoreAssets(
  assets: Asset[],
  deps: { generate?: ObjectGenerator } = {},
): Promise<QualityScore[]> {
  if (assets.length === 0) return [];
  const generate = deps.generate ?? (generateObject as unknown as ObjectGenerator);
  const { object } = await generate({
    model: anthropic(MODEL),
    schema: scoresSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Rate each real-estate photo 0..1 on sharpness, lighting, framing. " +
              "If a photo is a near-duplicate of a better one, set duplicateOf to " +
              "that photoId, else null. photoIds in order: " +
              assets.map((a) => a.photoId).join(", "),
          },
          ...assets.map((a) => ({ type: "image" as const, image: a.url })),
        ],
      },
    ],
  });
  const parsed = scoresSchema.parse(object);
  return parsed.scores.map((s) => ({
    photoId: s.photoId,
    sharpness: s.sharpness,
    lighting: s.lighting,
    framing: s.framing,
    overall: (s.sharpness + s.lighting + s.framing) / 3,
    duplicateOf: s.duplicateOf ?? undefined,
  }));
}
