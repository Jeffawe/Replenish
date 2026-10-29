import { z } from "zod";
import type { PurchaseLineSchema } from "@/core/purchase-batch";
import type { DraftLine, ExtractContext, ExtractResult, Extractor, Warning } from "../types";
import { normalizeProductName } from "@/core/product-name";
import { createIdentifier, itemFromLookup, seedData, type CodeLookup, type DictionaryData, type Identified } from "@/modules/dictionary/client";
import { groupIntoRows } from "./layout";
import { createMatcher, type LineMatch, type ProductAlias } from "./match";
import type { OcrEngine, OcrResult } from "./ocr/types";
import type { ReadSample } from "./samples";
import type { Reference, SimilarWordings } from "./similar-wordings";
import { receiptKey, sha256, totalMismatch } from "./totals";
import { parseReceipt, toDisplayName } from "./parse";

const MAX_BYTES = 8 * 1024 * 1024;

/** A receipt photo, as the UI uploads it. */
export const ReceiptInputSchema = z.object({
  image: z
    .instanceof(File, { error: "Choose a photo of the receipt" })
    .refine((file) => file.size > 0, "That file is empty")
    .refine((file) => file.size <= MAX_BYTES, "That photo is too large")
    .refine((file) => /^image\/(jpeg|png|webp|gif|bmp|tiff)$/.test(file.type), "Use a JPEG, PNG or WebP photo"),
});
export type ReceiptInput = z.infer<typeof ReceiptInputSchema>;

/** What the receipt producer needs from outside, so it can be tested without Google or a database. */
export interface ReceiptDeps {
  ocr: OcrEngine;
  /** Wordings the user has already told us belong to a product. */
  loadAliases(userId: string): Promise<ProductAlias[]>;
  /** Wordings (normalized) the user left out of an earlier receipt. */
  loadIgnored(userId: string): Promise<string[]>;
  /** What the dictionary knows (see src/modules/dictionary). Defaults to the starter list. */
  loadDictionary?(): Promise<DictionaryData>;
  /** What a product database says about product codes (UPCs), for lines nothing else can place. May fail or return little. */
  lookup?(codes: string[]): Promise<Map<string, CodeLookup>>;
  /** Finds the confirmed wording a line is closest to, for lines nothing else can place. May fail; matching goes on without it. */
  similar?: SimilarWordings;
  /**
   * Called before each photo goes to the OCR service, which costs quota. Throw an ExtractionError to refuse (the
   * user is out of photos). Return a function that gives the photo back if the read then fails.
   */
  beforeRead?(userId: string): Promise<() => Promise<void>>;
  /** Told what every photo read produced, for keeping test samples. Must not throw; a failure here can't fail a read. */
  record?(sample: ReadSample): Promise<void>;
}

type Line = z.input<typeof PurchaseLineSchema>;

const day = (date: Date) => date.toISOString().slice(0, 10);
const unitKey = (unit: string) => unit.trim().toLowerCase().replace(/s$/, "");
const PREPARED_DISH = /\b(?:sand(?:wich)?|pancakes?|grits|marsala|tikka|fried rice|naan|bhajia|b(?:ir|ri)yani|enchiladas?|quesadillas?|french toast|milk shake|burger|tenders?|entree|lunch|dinner|curry|flautas?|taquitos?|omelettes?|lollipop|grilled cheese|garlic fries|chips)\b/i;
const GENERIC_INGREDIENT = new Set([
  "Chicken", "Pork Chops", "Onions", "Garlic", "Rice", "Cheese", "Apples", "Shrimp", "Milk", "Pancake Mix",
]);

/**
 * Producer for receipt photos: read the text (OCR), rebuild its rows, pick out
 * the store, date, total and lines, then work out what each line is: the item
 * and brand (catalog.ts turns "GV WHL MLK GL" into Milk by Great Value), the
 * user's product it belongs to, and whether it is something that gets used up
 * at all. The result is a draft for the user to check; nothing is stored here.
 *
 * The idempotency key comes from the receipt's store, date and total, not from
 * the photo, so a second photo of the same receipt is recognized as the same
 * receipt. Without a readable total it falls back to the photo's bytes.
 */
export function createReceiptExtractor(deps: ReceiptDeps): Extractor<ReceiptInput> {
  async function draftFrom(bytes: Uint8Array, read: OcrResult, ctx: ExtractContext): Promise<ExtractResult> {
    const dictionary = await (deps.loadDictionary ?? (async () => seedData()))();
    const identify = createIdentifier(dictionary);
    if (read.words.length === 0) {
      return {
        kind: "skipped",
        reason: "We couldn't find any text in that photo. Try again with the whole receipt in frame and good light.",
      };
    }

    const rows = groupIntoRows(read.words);
    const sourceText = rows.join("\n");
    const parsed = parseReceipt(rows, ctx.now, identify);
    if (parsed.lines.length === 0) {
      return {
        kind: "skipped",
        reason: "We read the photo but couldn't find any items on it. Is the whole receipt in frame?",
        sourceText,
      };
    }

    const [aliases, ignored] = await Promise.all([deps.loadAliases(ctx.userId), deps.loadIgnored(ctx.userId)]);
    const match = createMatcher(ctx.products, aliases, parsed.store);
    const skippedBefore = new Set(ignored);
    const warnings: Warning[] = [];
    const items: Line[] = [];
    const lines: DraftLine[] = [];

    // A restaurant check lists meals, not things to restock: leave the dictionary and the user's products out of it, and start every line unticked.
    const restaurant = parsed.restaurant;
    const NOT_LOOKED_UP: Identified = { item: null, brand: null, withoutBrand: "" };

    // What each line is, from the cheap, sure sources: the dictionary and the user's own products.
    interface Resolved {
      known: Identified;
      isPreparedDish: boolean;
      found: LineMatch | null;
    }
    const resolved: Resolved[] = parsed.lines.map((line) => {
      const known = restaurant ? NOT_LOOKED_UP : identify(line.name, { code: line.code, store: parsed.store });
      // A restaurant dish containing a grocery word is the whole prepared dish,
      // not the single ingredient ("Chicken Marsala" is not raw Chicken).
      const isPreparedDish = PREPARED_DISH.test(line.name) && !!known.item && GENERIC_INGREDIENT.has(known.item.name);
      const catalogItem = isPreparedDish ? undefined : known.item;
      const found = restaurant || isPreparedDish ? null : match(line.name, catalogItem?.consumable ? catalogItem.name : undefined, line.code);
      return { known, isPreparedDish, found };
    });
    const open = (index: number) => !restaurant && !resolved[index]!.isPreparedDish && !resolved[index]!.found;

    // Lines still unplaced that carry a product code: ask a product database what it is. Whatever it says is only
    // a suggestion for the user to check, so a product it leads to is marked "check match".
    const unplacedWithCode = parsed.lines.flatMap((line, i) => (open(i) && !resolved[i]!.known.item && line.code ? [i] : []));
    if (deps.lookup && unplacedWithCode.length > 0) {
      const answers = await deps.lookup(unplacedWithCode.map((i) => parsed.lines[i]!.code!)).catch(() => new Map<string, CodeLookup>());
      for (const i of unplacedWithCode) {
        const line = parsed.lines[i]!;
        const answer = answers.get(line.code!);
        const from = answer ? itemFromLookup(answer, identify) : null;
        if (!from) continue;
        const known: Identified = { ...resolved[i]!.known, item: from.item, brand: resolved[i]!.known.brand ?? from.brand };
        const holder = from.item.consumable ? match.forItem(from.item.name) : null;
        resolved[i] = { ...resolved[i]!, known, found: holder ? { product: holder, by: "similar" } : null };
      }
    }

    // Lines still unplaced: find the confirmed wording each is closest to (the user's, and the dictionary's phrases).
    const unplaced = parsed.lines.flatMap((_, i) => (open(i) ? [i] : []));
    if (deps.similar && unplaced.length > 0) {
      const references: Reference[] = [
        ...aliases.filter((a) => !a.alias.startsWith("#")).map((a): Reference => ({ text: a.alias, target: { kind: "product", productId: a.productId } })),
        ...dictionary.terms.filter((t) => t.text.includes(" ")).map((t): Reference => ({ text: t.text, target: { kind: "item", name: t.item } })),
      ];
      const nearest = await deps.similar.nearest(unplaced.map((i) => parsed.lines[i]!.name), references).catch(() => unplaced.map(() => null));
      unplaced.forEach((i, k) => {
        const hit = nearest[k];
        if (!hit) return;
        const target = hit.target;
        const product = target.kind === "product" ? ctx.products.find((p) => p.id === target.productId) : match.forItem(target.name);
        const item = target.kind === "item" ? dictionary.items.find((entry) => entry.name === target.name) : undefined;
        resolved[i] = {
          ...resolved[i]!,
          known: item?.consumable && !resolved[i]!.known.item ? { ...resolved[i]!.known, item } : resolved[i]!.known,
          found: product ? { product, by: "similar" } : null,
        };
      });
    }

    parsed.lines.forEach((line, index) => {
      const { known, isPreparedDish, found } = resolved[index]!;
      const catalogItem = isPreparedDish ? undefined : known.item;
      const product = found?.product;

      let quantity = line.quantity > 0 ? line.quantity : 1;
      let unit = product?.unit ?? line.unit ?? catalogItem?.unit ?? "each";
      if (product && line.unit && unitKey(line.unit) !== unitKey(product.unit)) {
        // Weighed on the receipt, counted in the product: the weight says nothing about the count.
        warnings.push({
          code: "check-quantity",
          lineIndex: index,
          message: `This was sold by weight (${line.quantity} ${line.unit}) but ${product.name} is counted in ${product.unit}. Check the amount.`,
        });
        quantity = 1;
        unit = product.unit;
      }

      // A new product is named for the item ("Milk"), not the receipt's wording.
      const newName = catalogItem?.consumable ? catalogItem.name : toDisplayName(known.withoutBrand || line.name);
      // A line that is only a brand ("GREAT VALUE") says nothing about the item: keep the wording as the name for the user to fix, not "Great Value (Great Value)".
      const brand = known.brand && normalizeProductName(newName) !== normalizeProductName(known.brand) ? known.brand : null;
      items.push({
        productName: (product?.name ?? newName).slice(0, 200),
        ...(product && { productId: product.id }),
        ...(brand && { brand }),
        ...(!product && catalogItem?.consumable && { category: catalogItem.category }),
        quantity,
        unit,
        ...(line.priceCents !== null && { priceCents: line.priceCents }),
      });

      const excludeReason = skippedBefore.has(normalizeProductName(line.name))
        ? "You left this out last time."
        : restaurant
          ? "Looks like a restaurant meal, which doesn't need restocking."
          : known.item && !known.item.consumable
          ? `Looks like ${known.item.category}, which doesn't need restocking.`
          : undefined;
      lines.push({
        sourceText: line.name,
        matchedBy: found?.by ?? null,
        ...(line.code && { code: line.code }),
        ...(excludeReason && { excludeReason }),
      });
    });

    if (restaurant) {
      warnings.push({
        code: "restaurant-receipt",
        message: "This looks like a restaurant receipt, so every line starts unticked. Tick anything you do want to track.",
      });
    }
    if (!parsed.date) {
      warnings.push({
        code: "date-missing",
        message: "We couldn't read the date on this receipt, so it is set to today. Check it.",
      });
    }
    const totals = { subtotalCents: parsed.subtotalCents, discountsCents: parsed.discountsCents };
    const mismatch = totalMismatch(items, totals, parsed.currency);
    if (mismatch) warnings.push(mismatch);

    const purchasedAt = day(parsed.date ?? ctx.now);
    const key = receiptKey(parsed.store, purchasedAt, parsed.totalCents, sha256(bytes));

    return {
      kind: "draft",
      draft: {
        batch: {
          source: "receipt",
          idempotencyKey: key,
          ...(parsed.store && { store: parsed.store }),
          purchasedAt,
          currency: parsed.currency,
          rawRef: `receipt-photo:${sha256(bytes).slice(0, 16)}`,
          items,
        },
        warnings,
        lines,
        sourceText,
        totals: { ...totals, totalCents: parsed.totalCents },
      },
    };
  }

  return {
    source: "receipt",
    input: ReceiptInputSchema,
    async extract({ image }, ctx) {
      const bytes = new Uint8Array(await image.arrayBuffer());
      const giveBack = await deps.beforeRead?.(ctx.userId);
      let read;
      try {
        read = await deps.ocr.read(bytes);
      } catch (error) {
        // The service didn't read it (down, refused), so it shouldn't use up one of the user's photos.
        await giveBack?.().catch(() => {});
        throw error;
      }
      const result = await draftFrom(bytes, read, ctx);
      await deps.record?.({
        id: sha256(bytes).slice(0, 16),
        photo: bytes,
        mimeType: image.type,
        ocr: read,
        outcome: result.kind === "draft" ? { kind: "draft", draft: result.draft } : result,
      });
      return result;
    },
  };
}
