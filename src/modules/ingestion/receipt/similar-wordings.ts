/**
 * Finds the confirmed wording a new line is closest to in meaning, using a
 * small text encoder: "WHL MLK HALF GAL" lands near "GV WHL MLK GL", which
 * the user already put on Milk. It compares only against wordings that already
 * mean something (the user's confirmed wordings and the dictionary's phrases),
 * never against bare product names, because an encoder doesn't know receipt
 * abbreviations and would pick the nearest *different* word (BLACKBERRIES for
 * Blueberries). Early on, with little to compare against, most lines find
 * nothing, which is safe: they stay new products. It gets better as wordings
 * are confirmed.
 *
 * Pure apart from the embedder it is given, so it is tested with a fake one.
 */

/** Turns texts into unit-length vectors, so similarity is a dot product. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export type Target = { kind: "product"; productId: string } | { kind: "item"; name: string };

export interface Reference {
  text: string;
  target: Target;
}

export interface Nearest {
  target: Target;
  /** 0..1, how alike the line and the closest confirmed wording are. */
  score: number;
  /** The confirmed wording it was closest to. */
  reference: string;
}

export interface SimilarWordings {
  /** For each query, its closest target, or null when nothing is close enough or one clear winner is missing. */
  nearest(queries: string[], references: Reference[]): Promise<(Nearest | null)[]>;
}

/** Every number in the encoder layer. Tuned on receipts (see docs/dictionary.md); change a value and nothing else needs to change. */
export const ENCODER_CONFIG = {
  /** A line closer than this to a confirmed wording is suggested (to be checked, never trusted). 0.7 was right 84% of the time, 0.8 all of 4 in testing. */
  minScore: 0.75,
  /** The best target must beat the best *other* target by this much, or it is a guess between two. */
  minLead: 0.05,
  /** Texts with fewer letters than this say nothing (a bare "GAIN" is the dictionary's job). */
  minLetters: 4,
  /** Embedded texts remembered, so a wording is embedded once. */
  maxRemembered: 5000,
};

const targetKey = (target: Target) => (target.kind === "product" ? `p:${target.productId}` : `i:${target.name}`);
const letters = (text: string) => (text.match(/\p{L}/gu) ?? []).length;
const clean = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);

export function createSimilarWordings(embedder: Embedder, config = ENCODER_CONFIG): SimilarWordings {
  const remembered = new Map<string, number[]>();

  async function vectors(texts: string[]): Promise<Map<string, number[]>> {
    const missing = [...new Set(texts)].filter((text) => !remembered.has(text));
    if (missing.length > 0) {
      const made = await embedder.embed(missing);
      missing.forEach((text, i) => remembered.set(text, made[i]!));
      // Forget the oldest when full (Map keeps insertion order).
      while (remembered.size > config.maxRemembered) remembered.delete(remembered.keys().next().value!);
    }
    return remembered;
  }

  return {
    async nearest(queries, references) {
      const refs = references.filter((r) => letters(r.text) >= config.minLetters).map((r) => ({ ...r, text: clean(r.text) }));
      const asked = queries.map((q) => (letters(q) >= config.minLetters ? clean(q) : null));
      if (refs.length === 0 || asked.every((q) => q === null)) return queries.map(() => null);

      const known = await vectors([...refs.map((r) => r.text), ...asked.filter((q): q is string => q !== null)]);
      return asked.map((query) => {
        if (query === null) return null;
        const qv = known.get(query)!;
        // The best score per target, so many wordings of one product don't count as many candidates.
        const best = new Map<string, { target: Target; score: number; reference: string }>();
        for (const ref of refs) {
          const score = dot(qv, known.get(ref.text)!);
          const key = targetKey(ref.target);
          if (!best.has(key) || best.get(key)!.score < score) best.set(key, { target: ref.target, score, reference: ref.text });
        }
        const ranked = [...best.values()].sort((a, b) => b.score - a.score);
        const [top, next] = ranked;
        if (!top || top.score < config.minScore) return null;
        if (next && top.score - next.score < config.minLead) return null;
        return top;
      });
    },
  };
}
