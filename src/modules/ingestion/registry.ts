import type { Extractor } from "./types";

/**
 * Looks up a producer by its `source`. Adding a way of ingesting means a new
 * folder with an Extractor and one more entry in the list index.ts passes in.
 */
export function createRegistry(extractors: Extractor[]) {
  const bySource = new Map(extractors.map((extractor) => [extractor.source, extractor]));
  return function getExtractor(source: string): Extractor | undefined {
    return bySource.get(source);
  };
}
