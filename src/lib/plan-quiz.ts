// Pure logic for the homepage "Find your plan" quiz. Kept out of the component
// so the recommendation rules are unit-tested and the page can validate the
// `?qv=` / `?qp=` search params against the same option lists.

import type { PricingTierId } from "@/lib/pricing-tiers";

export const QUIZ_VALUE_OPTIONS = ["under", "mid", "over"] as const;
export const QUIZ_PHOTO_OPTIONS = ["self", "pro", "own"] as const;

export type QuizValue = (typeof QUIZ_VALUE_OPTIONS)[number];
export type QuizPhoto = (typeof QUIZ_PHOTO_OPTIONS)[number];

export function parseQuizValue(v: string | undefined): QuizValue | null {
  return (QUIZ_VALUE_OPTIONS as readonly string[]).includes(v ?? "")
    ? (v as QuizValue)
    : null;
}

export function parseQuizPhoto(v: string | undefined): QuizPhoto | null {
  return (QUIZ_PHOTO_OPTIONS as readonly string[]).includes(v ?? "")
    ? (v as QuizPhoto)
    : null;
}

// Sellers who shoot (or already have) their own photos fit Essentials.
// Sellers who want a professional shoot fit Pro, or Concierge for higher-value
// homes where premium photos + drone and dedicated broker support pay back.
// "over" means above QUIZ_HOME_VALUE_THRESHOLDS.conciergeMin (pricing-tiers.ts).
// This is only a recommendation: the CTA pre-selects the tier via
// ?suggested_tier=, and the seller can still pick any plan in listing step 2.
export function recommendTier(
  value: QuizValue | null,
  photo: QuizPhoto | null,
): PricingTierId | null {
  if (!value || !photo) return null;
  if (photo === "self" || photo === "own") return "essentials";
  return value === "over" ? "concierge" : "pro";
}
