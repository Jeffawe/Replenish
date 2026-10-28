import { getDemoUser } from "@/lib/demo-user";
import { listProductSummaries } from "@/modules/inventory/ingest";
import { AddPurchasesDialog } from "./add-purchases-dialog";

/** The "+" button. Loads the user's products so a receipt line can be tied to one. */
export async function AddPurchases() {
  const user = await getDemoUser();
  const products = await listProductSummaries(user.id);
  return <AddPurchasesDialog products={products.map(({ id, name, unit }) => ({ id, name, unit }))} />;
}
