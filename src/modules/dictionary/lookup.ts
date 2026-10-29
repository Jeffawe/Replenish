import { barcodeCandidates, isProductCode, type CodeLookup } from "./lookup-item";

/**
 * Asks Open Food Facts (a free, community product database) what a product
 * code is, once per code: answers, and "unknown", are kept so a code is never
 * asked about twice (an unknown one again after a while).
 *
 * Only the code is sent. Read their terms before changing how it is used:
 * identify the app in the User-Agent, keep to their rate limits, credit them
 * (their data is open-licensed). See docs/dictionary.md.
 */
export const LOOKUP_CONFIG = {
  endpoint: "https://world.openfoodfacts.org/api/v2/product",
  /** At most this many new codes are looked up per call; the rest wait for the next receipt. */
  maxPerCall: 12,
  concurrency: 2,
  timeoutMs: 2500,
  /** A code they didn't know is asked about again after this many days. */
  retryUnknownAfterDays: 30,
  userAgent: "Replenish/0.1 (household replenishment app, personal use)",
  /** After they say "too many requests", leave them alone for this long. */
  backOffMs: 2 * 60 * 1000,
};

export interface CachedLookup {
  code: string;
  found: boolean;
  lookup: CodeLookup | null;
  checkedAt: Date;
}

/** Where answers are kept. */
export interface LookupCache {
  get(codes: string[]): Promise<CachedLookup[]>;
  put(rows: CachedLookup[]): Promise<void>;
}

interface Deps {
  cache: LookupCache;
  fetch?: typeof fetch;
  now?: () => Date;
  userAgent?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const tidyCategory = (tag: string) => tag.replace(/^[a-z]{2}:/, "").replace(/-/g, " ");

async function ask(code: string, fetcher: typeof fetch, userAgent: string): Promise<CodeLookup | null | "failed" | "busy"> {
  try {
    const response = await fetcher(`${LOOKUP_CONFIG.endpoint}/${code}.json?fields=product_name,generic_name,brands,categories_tags`, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(LOOKUP_CONFIG.timeoutMs),
    });
    // 404 is how they say they don't know a code; anything else odd is a failure to try again later.
    if (response.status === 404) return null;
    if (response.status === 429) return "busy";
    if (!response.ok) return "failed";
    const body = (await response.json()) as { status?: number; product?: { product_name?: string; generic_name?: string; brands?: string; categories_tags?: string[] } };
    if (body.status !== 1 || !body.product) return null;
    const { product } = body;
    const name = (product.product_name || product.generic_name || "").trim() || null;
    return { name, brand: product.brands?.trim() || null, categories: (product.categories_tags ?? []).map(tidyCategory) };
  } catch {
    return "failed";
  }
}

/**
 * What the product database says about each code that looks like a UPC or
 * EAN: kept answers first, then new questions up to the per-call limit.
 * Never throws; a code that couldn't be asked about is simply missing.
 */
export function createLookup(deps: Deps) {
  const fetcher = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const userAgent = deps.userAgent ?? LOOKUP_CONFIG.userAgent;
  let backedOffUntil = 0;

  return async function lookupCodes(codes: string[]): Promise<Map<string, CodeLookup>> {
    const wanted = [...new Set(codes.filter(isProductCode))];
    const answers = new Map<string, CodeLookup>();
    if (wanted.length === 0) return answers;
    // The cache is read even when they've asked us to slow down; only new questions wait.
    const slowedDown = now().getTime() < backedOffUntil;

    const kept = new Map((await deps.cache.get(wanted)).map((row) => [row.code, row]));
    const stale = now().getTime() - LOOKUP_CONFIG.retryUnknownAfterDays * DAY_MS;
    const toAsk: string[] = [];
    for (const code of wanted) {
      const row = kept.get(code);
      if (row?.found && row.lookup) answers.set(code, row.lookup);
      else if (!row || row.checkedAt.getTime() < stale) toAsk.push(code);
    }

    const fresh: CachedLookup[] = [];
    const queue = slowedDown ? [] : toAsk.slice(0, LOOKUP_CONFIG.maxPerCall);
    await Promise.all(
      Array.from({ length: Math.min(LOOKUP_CONFIG.concurrency, queue.length) }, async () => {
        for (let code = queue.shift(); code; code = queue.shift()) {
          // The receipt's code may need turning into a real barcode; the first reading that they know wins.
          let result: CodeLookup | null | "failed" | "busy" = null;
          for (const barcode of barcodeCandidates(code)) {
            result = await ask(barcode, fetcher, userAgent);
            if (result !== null) break;
          }
          if (result === "busy") {
            backedOffUntil = now().getTime() + LOOKUP_CONFIG.backOffMs;
            queue.length = 0;
            return;
          }
          if (result === "failed") continue;
          fresh.push({ code, found: result !== null, lookup: result, checkedAt: now() });
          if (result) answers.set(code, result);
        }
      }),
    );
    if (fresh.length > 0) await deps.cache.put(fresh).catch((error) => console.error("Couldn't keep product lookups", error));
    return answers;
  };
}
