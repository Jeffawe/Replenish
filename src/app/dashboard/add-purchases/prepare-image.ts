// Phone photos are 3-8 MB and Server Actions accept 4 MB, so the photo is
// shrunk in the browser first. Receipts are long and narrow and the text is
// small, so the limit is on the longest side and generous.
const LONGEST_SIDE = 2400;
const MAX_BYTES = 3 * 1024 * 1024;
const QUALITIES = [0.85, 0.7, 0.55];

/**
 * Returns a JPEG of the photo small enough to upload, upright whatever way
 * the phone was held. If the browser can't decode the file (an unusual format)
 * it is sent as it is when it already fits.
 */
export async function prepareReceiptImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    for (const quality of QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_BYTES) return new File([blob], "receipt.jpg", { type: "image/jpeg" });
    }
  } catch {
    // Fall through to sending the original.
  }

  if (file.size <= MAX_BYTES) return file;
  throw new Error("That photo is too large and we couldn't shrink it. Try a smaller one.");
}
