// Virtual-staging style catalog + curated prompts.
//
// Goals for every prompt:
//   - Photoreal, not cartoon. Match the source's camera angle and lighting.
//   - Preserve architecture: walls, windows, doors, flooring, fixtures stay.
//   - Neutral palette so the furniture doesn't fight the room's features.
//   - No people, no logos, no text, no obstruction of architectural features.
//   - "Real estate photography" style anchor — these will be shown to buyers.

export type StagingStyle =
  | "modern"
  | "minimalist"
  | "traditional"
  | "warm";

export const STAGING_STYLES: StagingStyle[] = [
  "modern",
  "minimalist",
  "traditional",
  "warm",
];

export function isStagingStyle(v: string): v is StagingStyle {
  return (STAGING_STYLES as string[]).includes(v);
}

// Overage billing: each listing gets STAGING_FREE_QUOTA free staged photos;
// beyond that the seller buys credits at STAGING_OVERAGE_PRICE (USD) per action.
// STAGING_MAX_PURCHASE caps a single credit purchase.
export const STAGING_FREE_QUOTA = 5;
export const STAGING_OVERAGE_PRICE = 5;
export const STAGING_MAX_PURCHASE = 30;

// Each prompt ends with the same "preserve architecture" tail so the model
// is consistently constrained. Only the furniture style changes.
const ARCH_TAIL =
  "Do not alter walls, windows, doors, ceiling, flooring, light fixtures, or any architectural feature. " +
  "No people, no pets, no logos, no text, no signage. " +
  "Photorealistic real-estate interior photography, natural daylight, professional composition, 4K detail.";

export const STAGING_PROMPTS: Record<StagingStyle, string> = {
  modern:
    "Virtually furnish this empty room in contemporary modern style: low-profile sofa in oatmeal linen, " +
    "glass-and-metal coffee table, abstract framed art, sculptural floor lamp, indoor plants in matte ceramic. " +
    "Neutral palette of cream, charcoal, and brushed brass. " +
    ARCH_TAIL,
  minimalist:
    "Virtually furnish this empty room in minimalist Scandinavian style: light oak furniture, white linen upholstery, " +
    "one statement boucle chair, simple geometric rug, single ceramic vase. " +
    "Restrained palette of white, pale wood, and soft grey. No clutter, generous negative space. " +
    ARCH_TAIL,
  traditional:
    "Virtually furnish this empty room in classic traditional style: tufted sofa in muted slate blue, " +
    "walnut side tables, framed landscape artwork, table lamp with linen shade, patterned rug in subdued tones. " +
    "Palette of cream, walnut, and dusty blue. Tailored, timeless, refined. " +
    ARCH_TAIL,
  warm:
    "Virtually furnish this empty room in warm contemporary style: curved bouclé sofa in caramel, " +
    "mid-century walnut chair, woven jute rug, terracotta and ochre cushions, hanging brass pendant. " +
    "Palette of terracotta, ochre, caramel, and warm wood. Golden hour ambient light. " +
    ARCH_TAIL,
};

export function promptFor(style: StagingStyle): string {
  return STAGING_PROMPTS[style];
}
