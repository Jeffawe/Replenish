import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IngestResult } from "@/core/purchase-batch";
import type { Draft } from "../types";
import type { OcrResult } from "./ocr/types";

/**
 * Test samples: a folder per receipt photo holding what went in and what came
 * out, so real use becomes a test set (see scripts/review-samples.ts).
 *
 *   <dir>/<photo hash>/photo.jpg       the photo as the server received it
 *                      ocr.json        the words the OCR engine found
 *                      draft.json      what we read from it (or why we skipped it)
 *                      confirmed.json  what the user saved after editing the draft
 *
 * A folder with no confirmed.json is a receipt the user read but didn't save.
 * This is for testing only: it is off unless a folder is configured, and
 * nothing here may ever stop a receipt from being read or saved.
 */

/** A batch's `rawRef` for a receipt photo; it names the sample folder. */
const PHOTO_REF = /^receipt-photo:([0-9a-f]{16})$/;
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export interface ReadSample {
  /** First 16 hex digits of the photo's sha256; the folder's name. */
  id: string;
  photo: Uint8Array;
  mimeType: string;
  ocr: OcrResult;
  /** What the extractor made of it. */
  outcome: { kind: "draft"; draft: Draft } | { kind: "skipped"; reason: string };
}

export interface ConfirmedSample {
  batch: unknown;
  review?: unknown;
  result: IngestResult;
}

export interface SampleStore {
  saveRead(sample: ReadSample): Promise<void>;
  /** `rawRef` is the saved batch's; anything that doesn't name a receipt photo is ignored. */
  saveConfirmed(rawRef: string, sample: ConfirmedSample): Promise<void>;
}

export function createSampleStore(
  dir: string,
  now: () => Date = () => new Date(),
  onError: (message: string, error: unknown) => void = console.error,
): SampleStore {
  const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

  async function attempt(job: () => Promise<void>) {
    try {
      await job();
    } catch (error) {
      onError("Couldn't save a test sample", error);
    }
  }

  return {
    saveRead: ({ id, photo, mimeType, ocr, outcome }) =>
      attempt(async () => {
        // Anything else would let a caller write outside the samples folder.
        if (!/^[0-9a-f]{16}$/.test(id)) return;
        const folder = join(dir, id);
        await mkdir(folder, { recursive: true });
        await Promise.all([
          writeFile(join(folder, `photo.${EXTENSIONS[mimeType] ?? "jpg"}`), photo),
          writeFile(join(folder, "ocr.json"), json(ocr)),
          writeFile(join(folder, "draft.json"), json({ readAt: now().toISOString(), ...outcome })),
        ]);
      }),

    saveConfirmed: (rawRef, { batch, review, result }) =>
      attempt(async () => {
        const id = PHOTO_REF.exec(rawRef)?.[1];
        if (!id) return;
        const folder = join(dir, id);
        // Only photos that were read here with samples on have a folder; without one there is nothing to compare.
        if (!(await stat(folder).then((info) => info.isDirectory(), () => false))) return;
        await writeFile(join(folder, "confirmed.json"), json({ confirmedAt: now().toISOString(), batch, review, result }));
      }),
  };
}

