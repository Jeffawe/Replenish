import { normalizeProductName } from "@/core/product-name";
import type { PurchaseBatchInput } from "@/core/purchase-batch";
import type { DraftLine, ExtractResult, Extractor } from "../types";
import { canRead, readOrder, type ReadOrder } from "./reader";
import { originalSender, retailerOf } from "./retailers";
import { EmailMessageSchema, type EmailMessage } from "./types";

type ReadFn = (message: EmailMessage, store: string) => Promise<ReadOrder | null>;

/**
 * Producer for emails. A reader (reader.ts) turns the email into an order; this
 * ties its lines to the user's products and builds the batch. Only a line that
 * names one of the user's products exactly is tied to it; anything else becomes
 * a new product, which the user is asked about (see core/pending.ts).
 */
export function createEmailExtractor(read: ReadFn = readOrder, readable: (store: string) => boolean = canRead): Extractor<EmailMessage> {
  return {
    source: "email",
    input: EmailMessageSchema,
    async extract(message, ctx): Promise<ExtractResult> {
      const store = retailerOf(originalSender(message.from, message.text));
      if (!store) return { kind: "skipped", reason: "Not from a store we read" };
      if (!readable(store)) return { kind: "skipped", reason: `We can't read ${store} order emails yet` };

      const order = await read(message, store);
      if (!order) return { kind: "skipped", reason: "Not an order confirmation we can read" };

      const byName = new Map(ctx.products.filter((p) => p.matchByName).map((p) => [normalizeProductName(p.name), p]));
      const lines: DraftLine[] = [];
      const items: PurchaseBatchInput["items"] = order.lines.map((line, index) => {
        const product = byName.get(normalizeProductName(line.name));
        lines.push({ sourceText: line.name, matchedBy: product ? "name" : null });
        return {
          productName: product?.name ?? line.name,
          ...(product && { productId: product.id }),
          quantity: line.quantity,
          unit: line.unit ?? product?.unit ?? "each",
          ...(line.brand && { brand: line.brand }),
          ...(line.priceCents !== undefined && { priceCents: line.priceCents }),
          line: index,
        };
      });

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
