// LLM node: classify each photo by room type using Claude Vision. The object
// generator is injected for testability; production uses generateObject.
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { ROOM_TYPES, type Asset, type Classification } from "@/lib/media-intelligence/types";

const MODEL = "claude-sonnet-4-6";

export type ObjectGenerator = (args: {
  model: unknown;
  schema: unknown;
  messages: unknown;
}) => Promise<{ object: unknown }>;

const classificationsSchema = z.object({
  classifications: z.array(
    z.object({
      photoId: z.string(),
      roomType: z.enum(ROOM_TYPES),
      tags: z.array(z.string()),
      confidence: z.number(),
    }),
  ),
});

export async function classifyAssets(
  assets: Asset[],
  deps: { generate?: ObjectGenerator } = {},
): Promise<Classification[]> {
  if (assets.length === 0) return [];
  const generate = (deps.generate ?? (generateObject as unknown as ObjectGenerator));
  const { object } = await generate({
    model: anthropic(MODEL),
    schema: classificationsSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Classify each real-estate photo by room type. Return one entry per " +
              "photoId. Room types: " + ROOM_TYPES.join(", ") + ". " +
              "photoIds in order: " + assets.map((a) => a.photoId).join(", "),
          },
          ...assets.map((a) => ({ type: "image" as const, image: a.url })),
        ],
      },
    ],
  });
  const parsed = classificationsSchema.parse(object);
  return parsed.classifications;
}
