import { packSizeFrom } from "@/core/pick-offer";
import type { PurchaseBatchInput } from "@/core/purchase-batch";
import { createIdentifier, seedData, type DictionaryData } from "@/modules/dictionary/client";
import { createMatcher, type ProductAlias } from "../receipt/match";
import type { DraftLine, ExtractResult, Extractor } from "../types";
import { canRead, readOrder, type ReadOrder } from "./reader";
import { originalSender, retailerOf } from "./retailers";
import { EmailMessageSchema, type EmailMessage } from "./types";

type ReadFn = (message: EmailMessage, store: string) => Promise<ReadOrder | null>;

/** What matching knows, from the database. Without it: no saved wordings, and the starter dictionary. */
export interface EmailKnowledge {
  loadAliases?(userId: string): Promise<ProductAlias[]>;
  loadDictionary?(): Promise<DictionaryData>;
}

/**
 * Producer for emails. A reader (reader.ts) turns the email into an order; this ties its lines to the
 * user's products the same way a receipt does: saved wordings, the dictionary, then a clearly similar
 * name. "Charmin Ultra Soft Toilet Paper, 12 Mega Rolls" is 12 rolls of their Toilet Paper, not a new
 * product with that whole title for a name. A new product is named for the item.
 *
 * The user is asked about every line (see core/pending.ts), but an email has no screen to untick a line
 * on, so something that doesn't get used up is left out instead of being asked about.
 */
export function createEmailExtractor(read: ReadFn = readOrder, readable: (store: string) => boolean = canRead, knowledge: EmailKnowledge = {}): Extractor<EmailMessage> {
  return {
    source: "email",
    input: EmailMessageSchema,
    async extract(message, ctx): Promise<ExtractResult> {
      const store = retailerOf(originalSender(message.from, message.text));
      if (!store) return { kind: "skipped", reason: "Not from a store we read" };
      if (!readable(store)) return { kind: "skipped", reason: `We can't read ${store} order emails yet` };

      const order = await read(message, store);
      if (!order) return { kind: "skipped", reason: "Not an order confirmation we can read" };

      const [dictionary, aliases] = await Promise.all([knowledge.loadDictionary?.() ?? seedData(), knowledge.loadAliases?.(ctx.userId) ?? []]);
      const identify = createIdentifier(dictionary);
      const match = createMatcher(ctx.products, aliases, store);

      const lines: DraftLine[] = [];
      const items: PurchaseBatchInput["items"] = order.lines.flatMap((line, index) => {
        const known = identify(line.name);
        if (known.item && !known.item.consumable) return [];
        const item = known.item;
        const found = match(line.name, item?.name);
        const product = found?.product;
        const unit = product?.unit ?? line.unit ?? item?.unit ?? "each";
        // A title's pack size is how many of the product's unit this is, when it counts in something a title can count.
        const inPack = unit === "each" ? null : packSizeFrom(line.name, unit);
        lines.push({ sourceText: line.name, matchedBy: found?.by ?? null });
        return [
          {
            productName: (product?.name ?? item?.name ?? line.name).slice(0, 200),
            ...(product && { productId: product.id }),
            ...(!product && item && { category: item.category }),
            quantity: line.quantity * (inPack ?? 1),
            unit,
            ...((line.brand ?? known.brand) && { brand: line.brand ?? known.brand! }),
            ...(line.priceCents !== undefined && { priceCents: line.priceCents }),
            line: index,
          },
        ];
      });
      if (items.length === 0) return { kind: "skipped", reason: "Nothing in this order gets used up" };

      return {
        kind: "draft",
        draft: {
          batch: {
            source: "email",
            // The store's order number, so an order that arrives in two emails is stored once.
            idempotencyKey: `email-${store.toLowerCase()}-${order.orderId}`,
            store,
            purchasedAt: order.arrivesAt ?? message.receivedAt,
            items,
          },
          warnings: [],
          lines,
        },
      };
    },
  };
}

export const emailExtractor = createEmailExtractor();
