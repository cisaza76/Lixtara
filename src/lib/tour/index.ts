import type { TourProcessor } from "./processor";
import { geminiVideoProcessor } from "./processors/gemini-video";

export * from "./processor";

export function getTourProcessor(): TourProcessor {
  const engine = process.env.TOUR_ENGINE ?? "gemini-video";

  switch (engine) {
    case "gemini-video":
      return geminiVideoProcessor;

    default:
      throw new Error(`Unsupported TOUR_ENGINE: ${engine}`);
  }
}