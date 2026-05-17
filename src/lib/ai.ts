import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

// Single source for the Claude model used in F2.1+. Sonnet 4.6 = good
// balance of quality + speed + cost for listing copywriting. Swap to
// claude-opus-4-7 for higher quality (more expensive) or
// claude-haiku-4-5-20251001 for faster/cheaper.
const COPY_MODEL = "claude-sonnet-4-6";

interface ImproveDescriptionInput {
  description: string;
  facts: {
    bedrooms: number;
    bathrooms: number;
    sqft: number;
    yearBuilt: number;
    city: string;
    state: string;
    listPrice: number;
    propertyType: string;
    lotSize: number | null;
  };
}

/**
 * Improve a property description while preserving all specific facts.
 * Returns the improved text only — no quotes, no preamble.
 */
export async function improveListingDescription(
  input: ImproveDescriptionInput,
): Promise<string> {
  const { description, facts } = input;
  const factsLine = [
    `${facts.bedrooms}bd / ${facts.bathrooms}ba / ${facts.sqft.toLocaleString()} sqft`,
    `built ${facts.yearBuilt}`,
    `${facts.city}, ${facts.state}`,
    `type: ${facts.propertyType.replace("_", " ")}`,
    `list price: $${facts.listPrice.toLocaleString()}`,
    facts.lotSize ? `lot: ${facts.lotSize.toLocaleString()} sqft` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const { text } = await generateText({
    model: anthropic(COPY_MODEL),
    system:
      "You are a senior real estate copywriter for Florida listings. Improve descriptions to be 100-180 words, professional and warm but never cheesy. Keep every specific fact provided (square footage, bedrooms, year built, neighborhood, list price). Avoid clichés like 'must see', 'won't last', 'gem', 'opportunity of a lifetime'. Write in third person. Reply with ONLY the improved description text — no preamble, no quotes around it, no notes.",
    prompt: `Property facts: ${factsLine}\n\nCurrent description draft:\n"""${description}"""\n\nReturn the improved description only.`,
    maxOutputTokens: 600,
  });

  return text.trim();
}

/**
 * Polish showing instructions — short, concise, professional. Keeps any
 * specific contact info, lockbox codes, time windows, etc.
 */
export async function improveShowingInstructions(
  current: string,
): Promise<string> {
  const { text } = await generateText({
    model: anthropic(COPY_MODEL),
    system:
      "You polish showing instructions for Florida property listings sent to buyer's agents. Keep it under 240 characters, professional, concise, action-oriented. Preserve every specific detail the seller included (phone numbers, lockbox codes, time windows, contact persons). No clichés. Reply with ONLY the improved text — no preamble, no quotes around it.",
    prompt: `Current showing instructions draft:\n"""${current}"""\n\nReturn the improved text only.`,
    maxOutputTokens: 200,
  });
  return text.trim();
}
