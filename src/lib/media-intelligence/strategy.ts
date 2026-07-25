// LLM node: write the Media Strategy (the "mind"). The model returns a DRAFT
// (no prices); we validate it and fill estimatedCostUsd deterministically from
// the cost-table so prices are never hallucinated.
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  mediaStrategyDraftSchema,
  type Classification,
  type MediaStrategy,
  type SelectedShot,
} from "@/lib/media-intelligence/types";
import { estimateCostUsd } from "@/lib/media-intelligence/providers/cost-table";
import type { ObjectGenerator } from "@/lib/media-intelligence/classify";

const MODEL = "claude-sonnet-4-6";

export interface ListingFacts {
  price: number;
  beds: number;
  baths: number;
  city: string;
}

export async function buildStrategy(
  shots: SelectedShot[],
  classifications: Classification[],
  facts: ListingFacts,
  deps: { generate?: ObjectGenerator } = {},
): Promise<MediaStrategy> {
  const generate = deps.generate ?? (generateObject as unknown as ObjectGenerator);
  const { object } = await generate({
    model: anthropic(MODEL),
    schema: mediaStrategyDraftSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "You are a real-estate marketing strategist. Given this listing and its " +
              "selected hero shots, produce a Media Strategy. Do NOT include prices. " +
              `Listing: $${facts.price}, ${facts.beds}bd/${facts.baths}ba, ${facts.city}. ` +
              "Shots (order → room): " +
              shots.map((s) => `${s.order}:${s.roomType}`).join(", ") + ". " +
              "Rooms present: " +
              [...new Set(classifications.map((c) => c.roomType))].join(", ") + ". " +
              "recommendedOutputs.engine may be one of: mock, veo, kling, runway, luma, higgsfield, wan.",
          },
        ],
      },
    ],
  });
  const draft = mediaStrategyDraftSchema.parse(object);
  return {
    ...draft,
    recommendedOutputs: draft.recommendedOutputs.map((o) => ({
      capability: o.capability,
      engine: o.engine,
      estimatedCostUsd: estimateCostUsd(o.engine, o.capability),
    })),
  };
}
