import { describe, expect, it } from "vitest";
import { createSimilarWordings, type Embedder, type Reference } from "./similar-wordings";

/** A stand-in for the model: texts that share letters-in-order trigrams are close. Deterministic and offline. */
function fakeEmbedder(): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  const dims = 256;
  return {
    calls,
    async embed(texts) {
      calls.push(texts);
      return texts.map((text) => {
        const v = new Array<number>(dims).fill(0);
        const t = ` ${text.toLowerCase()} `;
        for (let i = 0; i < t.length - 2; i++) {
          let h = 0;
          for (const c of t.slice(i, i + 3)) h = (h * 31 + c.charCodeAt(0)) % dims;
          v[h]! += 1;
        }
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
        return v.map((x) => x / norm);
      });
    },
  };
}

const milk = { kind: "product", productId: "p-milk" } as const;
const eggs = { kind: "product", productId: "p-eggs" } as const;
const refs: Reference[] = [
  { text: "GV WHL MLK GL", target: milk },
  { text: "MILK GAL WHOLE", target: milk },
  { text: "LRG EGGS 18CT", target: eggs },
];

describe("finding the closest confirmed wording", () => {
  it("suggests the target of a wording that is close, and says which wording it was", async () => {
    const [found] = await createSimilarWordings(fakeEmbedder()).nearest(["GV WHL MLK GI"], refs);
    expect(found).toMatchObject({ target: milk, reference: "gv whl mlk gl" });
    expect(found!.score).toBeGreaterThan(0.75);
  });

  it("finds nothing when nothing is close, so the line stays a new product", async () => {
    expect(await createSimilarWordings(fakeEmbedder()).nearest(["BLACKBERRIES 6OZ"], refs)).toEqual([null]);
  });

  it("finds nothing with nothing to compare against", async () => {
    expect(await createSimilarWordings(fakeEmbedder()).nearest(["GV WHL MLK GL"], [])).toEqual([null]);
  });

  it("won't pick between two products whose wordings are both close", async () => {
    const tied: Reference[] = [
      { text: "KIRKLAND ORG MILK 1", target: milk },
      { text: "KIRKLAND ORG MILK 2", target: { kind: "product", productId: "p-oat" } },
    ];
    expect(await createSimilarWordings(fakeEmbedder()).nearest(["KIRKLAND ORG MILK 3"], tied)).toEqual([null]);
  });

  it("answers each query on its own, and ignores texts with too few letters", async () => {
    const found = await createSimilarWordings(fakeEmbedder()).nearest(["GV WHL MLK GI", "123", "LRG EGGS 12CT"], refs);
    expect(found.map((f) => f?.target)).toEqual([milk, undefined, eggs]);
  });

  it("works with item targets as well as products", async () => {
    const [found] = await createSimilarWordings(fakeEmbedder()).nearest(["ALMOND MILK UNSWEETENED"], [{ text: "almond milk unsweet", target: { kind: "item", name: "Almond Milk" } }]);
    expect(found?.target).toEqual({ kind: "item", name: "Almond Milk" });
  });

  it("embeds a text once, however many times it is asked about", async () => {
    const embedder = fakeEmbedder();
    const similar = createSimilarWordings(embedder);
    await similar.nearest(["GV WHL MLK GI"], refs);
    await similar.nearest(["GV WHL MLK GI", "LRG EGGS 12CT"], refs);
    const embedded = embedder.calls.flat();
    expect(new Set(embedded).size).toBe(embedded.length);
  });
});
