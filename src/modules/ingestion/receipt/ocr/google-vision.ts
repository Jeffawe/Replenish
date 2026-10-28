import { ExtractionError } from "../../types";
import type { OcrEngine, OcrResult, OcrWord } from "./types";

const ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

interface Vertex {
  x?: number;
  y?: number;
}

interface VisionResponse {
  responses?: {
    textAnnotations?: { description?: string; boundingPoly?: { vertices?: Vertex[] } }[];
    error?: { code?: number; message?: string };
  }[];
  error?: { code?: number; message?: string };
}

interface Options {
  /** Defaults to GOOGLE_VISION_API_KEY, read when a photo is read, not at import. */
  apiKey?: string;
  fetch?: typeof fetch;
}

/**
 * OCR through Google Cloud Vision (DOCUMENT_TEXT_DETECTION, which is the mode
 * meant for dense printed text). Needs the Cloud Vision API enabled on a
 * Google Cloud project and an API key restricted to it.
 */
export function createGoogleVisionEngine(options: Options = {}): OcrEngine {
  return {
    async read(image) {
      const apiKey = options.apiKey ?? process.env.GOOGLE_VISION_API_KEY;
      if (!apiKey) {
        throw new ExtractionError(
          "Receipt reading isn't set up yet. Add GOOGLE_VISION_API_KEY to .env.local and restart the server.",
        );
      }

      let response: Response;
      try {
        response = await (options.fetch ?? fetch)(ENDPOINT, {
          method: "POST",
          // In a header, not the URL, so the key doesn't end up in logs.
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            requests: [
              {
                image: { content: Buffer.from(image).toString("base64") },
                features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
              },
            ],
          }),
        });
      } catch {
        throw new ExtractionError("Couldn't reach Google Vision. Check the connection and try again.");
      }

      const body = (await response.json().catch(() => null)) as VisionResponse | null;
      const failure = body?.error ?? body?.responses?.[0]?.error;
      if (!response.ok || failure) {
        throw new ExtractionError(describeFailure(response.status, failure?.message));
      }

      return toOcrResult(body?.responses?.[0]?.textAnnotations ?? []);
    },
  };
}

function describeFailure(status: number, googleMessage: string | undefined): string {
  const message = googleMessage?.replace(/[.\s]+$/, "");
  if (status === 400 && message?.toLowerCase().includes("api key")) {
    return "Google rejected the API key. Check GOOGLE_VISION_API_KEY.";
  }
  if (status === 403) {
    return `Google refused the request${message ? `: ${message}` : ""}. Check that the Cloud Vision API is enabled, billing is attached and the key may use it.`;
  }
  if (status === 429) return "Google Vision is rate limiting us. Try again in a moment.";
  return `Google Vision failed (${status})${message ? `: ${message}` : ""}.`;
}

/** The first annotation is the whole text; every one after it is a single word. */
function toOcrResult(annotations: NonNullable<NonNullable<VisionResponse["responses"]>[number]["textAnnotations"]>): OcrResult {
  const [whole, ...parts] = annotations;
  const words: OcrWord[] = [];
  for (const part of parts) {
    const vertices = part.boundingPoly?.vertices;
    if (!part.description || !vertices || vertices.length < 4) continue;
    // Vision leaves out a coordinate that is 0.
    const points = vertices.map((v) => ({ x: v.x ?? 0, y: v.y ?? 0 }));
    const [a, b, , d] = points;
    words.push({
      text: part.description,
      cx: points.reduce((sum, v) => sum + v.x, 0) / points.length,
      cy: points.reduce((sum, v) => sum + v.y, 0) / points.length,
      // Vertices run clockwise from the top-left of the text, whatever way up it is.
      width: Math.hypot(b.x - a.x, b.y - a.y),
      height: Math.hypot(d.x - a.x, d.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    });
  }
  return { text: whole?.description ?? "", words };
}
