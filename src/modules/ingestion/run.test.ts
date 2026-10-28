import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ProductSummary, PurchaseSummary } from "@/core/purchase-batch";
import { createExtractionRunner, type RunDeps } from "./run";
import type { ExtractContext, ExtractResult, Extractor } from "./types";

const products: ProductSummary[] = [
  { id: "toilet", name: "Charmin Toilet Paper", brand: null, category: null, unit: "rolls", normalPurchaseQty: 12 },
];
const now = new Date("2026-10-21T12:00:00Z");

const draftResult = (overrides = {}): ExtractResult => ({
  kind: "draft",
  draft: {
    batch: {
      source: "fake",
      idempotencyKey: "fake-key-1234",
      store: "Walmart",
      purchasedAt: "2026-10-20",
      items: [{ productName: "Charmin Toilet Paper", quantity: 12, unit: "rolls" }],
      ...overrides,
    },
    warnings: [{ code: "from-producer", message: "producer note" }],
  },
});

function setup(result: ExtractResult | (() => ExtractResult), nearby: PurchaseSummary[] = []) {
  const extract = vi.fn<(input: { text: string }, ctx: ExtractContext) => Promise<ExtractResult>>(
    async () => (typeof result === "function" ? result() : result),
  );
  const extractor: Extractor<{ text: string }> = {
    source: "fake",
    input: z.object({ text: z.string() }),
    extract,
  };
  const loadProducts = vi.fn(async () => products);
  const loadNearby = vi.fn(async () => nearby);
  const deps: RunDeps = {
    getExtractor: (source) => (source === "fake" ? (extractor as Extractor) : undefined),
    loadProducts,
    loadNearby,
    now: () => now,
  };
  return { run: createExtractionRunner(deps), extract, loadProducts, loadNearby };
}

describe("createExtractionRunner", () => {
  it("reports an unknown source without loading anything", async () => {
    const { run, loadProducts } = setup(draftResult());
    expect(await run("nope", {}, "user-1")).toEqual({ ok: false, error: "unknown-source" });
    expect(loadProducts).not.toHaveBeenCalled();
  });

  it("rejects input the producer's schema does not accept", async () => {
    const { run, extract } = setup(draftResult());
    const outcome = await run("fake", { text: 42 }, "user-1");
    expect(outcome).toMatchObject({ ok: false, error: "invalid-input" });
    expect(outcome.ok === false && "issues" in outcome && outcome.issues[0].path).toBe("text");
    expect(extract).not.toHaveBeenCalled();
  });

  it("gives the producer its parsed input and the user's products", async () => {
    const { run, extract } = setup(draftResult());
    await run("fake", { text: "hello", ignored: true }, "user-1");
    expect(extract).toHaveBeenCalledWith({ text: "hello" }, { userId: "user-1", products, now });
  });

  it("passes a skipped result straight through without checking for duplicates", async () => {
    const skipped: ExtractResult = { kind: "skipped", reason: "not an order" };
    const { run, loadNearby } = setup(skipped);
    expect(await run("fake", { text: "x" }, "user-1")).toEqual({ ok: true, result: skipped });
    expect(loadNearby).not.toHaveBeenCalled();
  });

  it("adds duplicate warnings after the producer's own", async () => {
    const nearby: PurchaseSummary[] = [
      {
        productId: "toilet",
        store: "Walmart",
        quantity: 12,
        purchasedAt: new Date("2026-10-20T08:00:00Z"),
        idempotencyKey: "something-else",
      },
    ];
    const { run, loadNearby } = setup(draftResult(), nearby);
    const outcome = await run("fake", { text: "x" }, "user-1");

    expect(loadNearby).toHaveBeenCalledWith("user-1", new Date("2026-10-20"));
    const result = outcome.ok ? outcome.result : null;
    expect(result?.kind === "draft" && result.draft.warnings.map((w) => w.code)).toEqual([
      "from-producer",
      "possible-duplicate",
    ]);
  });

  it("leaves the draft's own warnings alone when nothing looks duplicated", async () => {
    const { run } = setup(draftResult());
    const outcome = await run("fake", { text: "x" }, "user-1");
    const result = outcome.ok ? outcome.result : null;
    expect(result?.kind === "draft" && result.draft.warnings.map((w) => w.code)).toEqual(["from-producer"]);
  });

  it("still returns a draft whose date is unusable, leaving it for submit to reject", async () => {
    const { run, loadNearby } = setup(draftResult({ purchasedAt: "last tuesday" }));
    const outcome = await run("fake", { text: "x" }, "user-1");
    expect(outcome).toMatchObject({ ok: true, result: { kind: "draft" } });
    expect(loadNearby).not.toHaveBeenCalled();
  });
});
