/**
 * One word the OCR engine found. Measurements are in image pixels and do not
 * depend on how the photo is rotated: `angle` is the direction the word's text
 * runs in (radians, 0 = left to right, as the engine reports it).
 */
export interface OcrWord {
  text: string;
  /** Centre of the word. */
  cx: number;
  cy: number;
  /** Length along the text, and across it. */
  width: number;
  height: number;
  angle: number;
}

export interface OcrResult {
  /** Everything the engine read, as it laid it out. For showing the user, not for parsing. */
  text: string;
  words: OcrWord[];
}

/**
 * Reads the text in a photo. The one thing receipt reading needs from an OCR
 * service, so swapping Google Vision for another engine means writing one more
 * of these and changing the composition root.
 */
export interface OcrEngine {
  read(image: Uint8Array): Promise<OcrResult>;
}
