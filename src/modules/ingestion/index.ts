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
import { lessonsFromReview, type Review } from "./aliases";
import { emailExtractor } from "./email/extractor";
import { syncInbox } from "./email/sync";
import type { InboxProvider } from "./email/types";
import { createReceiptExtractor } from "./receipt/extractor";
import { createGoogleVisionEngine } from "./receipt/ocr/google-vision";
import { createSampleStore, samplesFolder } from "./receipt/samples";
import { createRegistry } from "./registry";
import { createExtractionRunner } from "./run";
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
    record: samples?.saveRead,
  }),
  emailExtractor,
]);

/** Validate a batch and store it. */
export const submitBatch = createSubmit(ingestPurchaseBatch);

/** Run the producer for `source` on raw input and return a draft (stores nothing). */
export const extractPurchases = createExtractionRunner({
  getExtractor,
  loadProducts: listProductSummaries,
  loadNearby: listPurchasesNear,
});

/**
 * After a reviewed draft was stored, remember what the user taught us: how
 * its lines were worded for the products they landed on, and which wordings
 * they left out, so the next receipt needs less help.
 */
export async function learnFromReview(userId: string, review: Review, result: IngestResult) {
  const { aliases, ignore, keep } = lessonsFromReview(review, result);
  await Promise.all([saveAliases(userId, aliases), updateIgnoredWordings(userId, ignore, keep)]);
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
