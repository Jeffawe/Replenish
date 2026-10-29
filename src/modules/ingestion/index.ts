/**
 * The composition root: the one place ingestion is connected to the real
 * database code in inventory. Everything else in this module takes what it
 * needs as parameters, so it can be tested without a database. Triggers
 * (server actions, route handlers) import from here.
 */
import {
  listAliases,
  listIgnoredWordings,
  saveAliases,
  updateIgnoredWordings,
} from "@/modules/inventory/aliases";
import {
  ingestPurchaseBatch,
  listProductSummaries,
  listPurchasesNear,
} from "@/modules/inventory/ingest";
import type { IngestResult } from "@/core/purchase-batch";
import { learnFromSave, loadDictionary, lookupProductCodes } from "@/modules/dictionary";
import { lessonsFromReview, type Review } from "./aliases";
import { emailExtractor } from "./email/extractor";
import { syncInbox } from "./email/sync";
import type { InboxProvider } from "./email/types";
import { createReceiptExtractor } from "./receipt/extractor";
import { createModelEmbedder } from "./receipt/encoder-model";
import { createGoogleVisionEngine } from "./receipt/ocr/google-vision";
import { createSampleStore, samplesFolder } from "./receipt/samples";
import { createSimilarWordings } from "./receipt/similar-wordings";
import { createRegistry } from "./registry";
import { DraftSchema } from "./draft-schema";
import type { Draft } from "./types";
import { mergeDrafts } from "./receipt/merge";
import { whyDifferentReceipt } from "./receipt/same-receipt";
import { createDuplicateChecker, createExtractionRunner, type RunOutcome } from "./run";
import { createSubmit } from "./submit";

/**
 * Test samples (receipt photo, OCR, draft, what the user confirmed) are kept
 * only when SAMPLES_DIR names a folder. Leave it unset on a live deploy.
 */
const samples = process.env.SAMPLES_DIR ? createSampleStore(samplesFolder(process.env.SAMPLES_DIR)) : null;

/** Every producer. A new way of ingesting is added here. */
const getExtractor = createRegistry([
  createReceiptExtractor({
    ocr: createGoogleVisionEngine(),
    loadAliases: listAliases,
    loadIgnored: listIgnoredWordings,
    loadDictionary,
    lookup: lookupProductCodes,
    similar: createSimilarWordings(createModelEmbedder()),
    record: samples?.saveRead,
  }),
  emailExtractor,
]);

// Everything outside this folder imports from here (server code) or from ./client (browser code), never from deeper files.
export { createSimulatedInbox } from "./email/inbox/simulated";
export { ExtractionError } from "./types";
export type { RunOutcome } from "./run";
export type AddPhotoOutcome =
  | RunOutcome
  | { ok: false; error: "invalid-draft" }
  /** The photo reads like another receipt. `photoDraft` is what it holds, to merge anyway with `mergeReceiptDrafts` (no second read). */
  | { ok: false; error: "different-receipt"; reasons: string[]; photoDraft: Draft };

/** Validate a batch and store it. */
export const submitBatch = createSubmit(ingestPurchaseBatch);

/** What the duplicate check reads from storage. */
const loadForDuplicates = { loadProducts: listProductSummaries, loadNearby: listPurchasesNear };

/** Run the producer for `source` on raw input and return a draft (stores nothing). */
export const extractPurchases = createExtractionRunner({ getExtractor, ...loadForDuplicates });

/**
 * Reads another photo of a receipt and adds what it shows to the draft the
 * user already has (a long receipt in two photos, or a first photo that
 * missed something). Returns the merged draft; stores nothing.
 */
export async function addPhotoToReceiptDraft(userId: string, previous: unknown, rawInput: unknown): Promise<AddPhotoOutcome> {
  const parsed = DraftSchema.safeParse(previous);
  if (!parsed.success) return { ok: false, error: "invalid-draft" };

  const outcome = await extractPurchases("receipt", rawInput, userId);
  if (!outcome.ok || outcome.result.kind !== "draft") return outcome;

  const reasons = whyDifferentReceipt(parsed.data, outcome.result.draft);
  if (reasons.length > 0) return { ok: false, error: "different-receipt", reasons, photoDraft: outcome.result.draft };
  return mergeReceiptDrafts(userId, parsed.data, outcome.result.draft);
}

/** Adds one draft to another and checks the result for duplicates. Both come from the browser, so both are checked. */
export async function mergeReceiptDrafts(userId: string, previous: unknown, photoDraft: unknown): Promise<AddPhotoOutcome> {
  const first = DraftSchema.safeParse(previous);
  const second = DraftSchema.safeParse(photoDraft);
  if (!first.success || !second.success) return { ok: false, error: "invalid-draft" };
  const merged: Draft = mergeDrafts(first.data, second.data);
  return { ok: true, result: { kind: "draft", draft: await createDuplicateChecker(loadForDuplicates)(merged, userId) } };
}

/**
 * After a reviewed draft was stored, remember what the user taught us: how
 * its lines were worded for the products they landed on, and which wordings
 * they left out, so the next receipt needs less help.
 */
export async function learnFromReview(userId: string, review: Review, result: IngestResult, receiptKey?: string) {
  const { aliases, ignore, keep } = lessonsFromReview(review, result);
  await Promise.all([saveAliases(userId, aliases), updateIgnoredWordings(userId, ignore, keep)]);
  if (receiptKey) await teachDictionary(userId, review, result, receiptKey);
}

/**
 * Tells the shared dictionary what the user's choices showed: each saved line's
 * wording (and the store's code for it) belongs to the product it landed on.
 * The dictionary decides what to make of it (see src/modules/dictionary/learn.ts).
 * A failure here never affects the save.
 */
async function teachDictionary(userId: string, review: Review, result: IngestResult, receipt: string) {
  try {
    const products = new Map((await listProductSummaries(userId)).map((product) => [product.id, product]));
    const observations = result.items.flatMap((line) => {
      if (line.result === "rejected") return [];
      const wording = review.sources[line.index];
      const product = products.get(line.productId);
      if (!wording || !product) return [];
      return [
        {
          receipt,
          wording,
          code: review.codes?.[line.index] ?? undefined,
          store: review.store,
          productName: product.name,
          productUnit: product.unit,
          productCategory: product.category,
          productCreated: line.result === "created" && line.productCreated,
        },
      ];
    });
    await learnFromSave(observations);
  } catch (error) {
    console.error("Couldn't teach the dictionary", error);
  }
}

/** Keeps what the user confirmed next to the sample it came from, when samples are on. Never throws. */
export async function recordConfirmedSample(batch: unknown, review: unknown, result: IngestResult) {
  const rawRef = (batch as { rawRef?: unknown } | null)?.rawRef;
  if (samples && typeof rawRef === "string") await samples.saveConfirmed(rawRef, { batch, review, result });
}

/** Read new mail from `inbox` and record any purchases in it. */
export function syncEmailInbox(userId: string, since: Date, inbox: InboxProvider) {
  return syncInbox(userId, since, {
    inbox,
    extract: (message) => extractPurchases("email", message, userId),
    submit: submitBatch,
  });
}
