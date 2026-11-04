import { z } from "zod";
import { applyReview, listingsToReview, REVIEW_SYSTEM, reviewPrompt, ReviewSchema } from "@/core/review-listings";
import type { PickedOffer, Wanted } from "@/core/pick-offer";
import { geminiFromEnv } from "./gemini";

/**
 * Any language model that can answer in JSON. A new provider is one small file with this shape and a
 * line in PROVIDERS, and nothing else changes: choose it with AI_PROVIDER, its model with AI_MODEL.
 */
export interface JsonModel {
  /** The model's answer, parsed from JSON. Throws if it can't answer. */
  json(request: { system: string; prompt: string; schema: Record<string, unknown> }): Promise<unknown>;
}

const PROVIDERS: Record<string, () => JsonModel | null> = {
  gemini: geminiFromEnv,
};

/** The model from the environment, or null when it isn't set up. AI_REVIEW=off turns it off. */
export function modelFromEnv(): JsonModel | null {
  if (process.env.AI_REVIEW === "off") return null;
  const name = process.env.AI_PROVIDER?.trim().toLowerCase() || "gemini";
  const build = PROVIDERS[name];
  if (!build) {
    console.error(`AI_PROVIDER is "${name}", which isn't one we know, so listings are chosen by the rules alone.`);
    return null;
  }
  return build();
}

export interface ListingReviewer {
  /** The listings after the model's say, or null when it has none (it failed): the rules' order then stands. */
  review(wanted: Wanted, picks: PickedOffer[]): Promise<{ picks: PickedOffer[]; reason: string | null } | null>;
}

/** Never throws: a model that is down or talks nonsense mustn't stop a product being found. */
export function createListingReviewer(model: JsonModel): ListingReviewer {
  const schema = z.toJSONSchema(ReviewSchema, { target: "draft-7" }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    async review(wanted, picks) {
      if (listingsToReview(picks).length === 0) return null;
      try {
        const raw = await model.json({ system: REVIEW_SYSTEM, prompt: reviewPrompt(wanted, listingsToReview(picks)), schema });
        return applyReview(picks, ReviewSchema.parse(raw), wanted);
      } catch (error) {
        console.error(`The AI couldn't review the listings for ${wanted.name}, so the rules chose:`, error instanceof Error ? error.message : error);
        return null;
      }
    },
  };
}

export function listingReviewerFromEnv(): ListingReviewer | null {
  const model = modelFromEnv();
  return model ? createListingReviewer(model) : null;
}
