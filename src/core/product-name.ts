/** Normalizes a product name for matching incoming events to a product. */
export function normalizeProductName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
