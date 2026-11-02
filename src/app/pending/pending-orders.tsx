import { requireUser } from "@/modules/auth";
import { listProductSummaries } from "@/modules/inventory/ingest";
import { listPendingPurchases } from "@/modules/inventory/pending";
import { PendingBanner, type PendingOrder } from "./pending-banner";

/** Orders that arrived by email and are waiting for a look. Loaded with the dashboard. */
export async function PendingOrders() {
  const user = await requireUser();
  const now = new Date();
  const [pending, products] = await Promise.all([listPendingPurchases(user.id, now), listProductSummaries(user.id)]);

  // Lines of one email are one order.
  const orders = new Map<string, PendingOrder>();
  for (const line of pending) {
    const key = line.orderKey ?? line.id;
    const order =
      orders.get(key) ??
      { key, store: line.store, date: line.purchasedAt.toISOString().slice(0, 10), onTheWay: line.purchasedAt > now, lines: [] };
    order.lines.push({
      id: line.id,
      productId: line.productId,
      name: line.productName,
      unit: line.unit,
      quantity: line.quantity,
      brand: line.brand,
      isNew: line.madeProduct,
    });
    orders.set(key, order);
  }

  return (
    <PendingBanner
      orders={[...orders.values()]}
      products={products.map(({ id, name, unit }) => ({ id, name, unit }))}
    />
  );
}
