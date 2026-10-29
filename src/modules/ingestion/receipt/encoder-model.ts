import type { Embedder } from "./similar-wordings";

/**
 * The real text encoder: a small sentence model (all-MiniLM-L6-v2, quantized,
 * about 23 MB) run inside the server through @huggingface/transformers. It is
 * downloaded the first time it is used (set ENCODER_CACHE_DIR to choose where
 * it is kept; `npm run encoder -- warm` fetches it ahead of time) and then
 * runs offline. Set ENCODER=off to turn the encoder layer off.
 *
 * Loaded lazily, so nothing else pays for it. Any failure (offline on first
 * use, no disk, unsupported machine) is reported once and the encoder stays
 * out of the way for a while; matching simply goes on without it.
 */
export const ENCODER_MODEL = {
  name: "Xenova/all-MiniLM-L6-v2",
  batchSize: 32,
  /** After a failure, don't try again for this long. */
  retryAfterMs: 5 * 60 * 1000,
};

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: true }) => Promise<{ tolist(): number[][] }>;

export function createModelEmbedder(): Embedder {
  let loading: Promise<Extractor> | null = null;
  let failedAt = 0;

  async function load(): Promise<Extractor> {
    const { pipeline, env } = await import("@huggingface/transformers");
    if (process.env.ENCODER_CACHE_DIR) env.cacheDir = process.env.ENCODER_CACHE_DIR;
    return (await pipeline("feature-extraction", ENCODER_MODEL.name, { dtype: "q8" } as never)) as unknown as Extractor;
  }

  return {
    async embed(texts) {
      if (process.env.ENCODER === "off") throw new Error("The encoder is turned off (ENCODER=off).");
      if (failedAt && Date.now() - failedAt < ENCODER_MODEL.retryAfterMs) throw new Error("The encoder isn't available right now.");
      try {
        loading ??= load();
        const extract = await loading;
        const out: number[][] = [];
        for (let i = 0; i < texts.length; i += ENCODER_MODEL.batchSize) {
          const tensor = await extract(texts.slice(i, i + ENCODER_MODEL.batchSize), { pooling: "mean", normalize: true });
          out.push(...tensor.tolist());
        }
        return out;
      } catch (error) {
        loading = null;
        failedAt = Date.now();
        console.error("The text encoder couldn't run, so receipt matching goes on without it:", error instanceof Error ? error.message : error);
        throw error;
      }
    },
  };
}
