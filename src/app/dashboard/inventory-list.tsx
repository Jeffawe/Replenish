import { getDemoUser } from "@/lib/demo-user";
import { getInventory } from "@/modules/inventory/service";
import { InventoryCard, getStatus } from "./inventory-card";

export async function InventoryList() {
  const user = await getDemoUser();
  const items = await getInventory(user.id);
  // Read after the queries so the clock is a request-time value.
  const now = new Date();

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
        <h2 className="text-base font-semibold">No products yet</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Tap the + button above to add a receipt and what you bought shows up here. Or run{" "}
          <code>npm run db:seed</code> to load demo data.
        </p>
      </div>
    );
  }

  // Every product, so a duplicate can be merged into the right one.
  const others = items.map(({ product }) => ({ id: product.id, name: product.name, unit: product.unit }));

  const categories = [
    ...new Set(items.map((i) => i.product.category).filter((c): c is string => !!c)),
  ].sort();

  const counts = { low: 0, ok: 0, unknown: 0 };
  for (const { estimate } of items) {
    const { tone } = getStatus(estimate);
    if (tone === "unknown") counts.unknown++;
    else if (tone === "ok") counts.ok++;
    else counts.low++;
  }

  return (
    <>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <Stat label="Low or out" value={counts.low} />
        <Stat label="Stocked" value={counts.ok} />
        <Stat label="Needs data" value={counts.unknown} />
      </dl>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <InventoryCard key={item.product.id} item={item} now={now} categories={categories} others={others} />
        ))}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
