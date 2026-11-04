import { describe, expect, it } from "vitest";
import { canOrderFrom, packSizeFrom, pickOffers, type Candidate, type Wanted } from "./pick-offer";
import { applyReview, listingsToReview, reviewPrompt, type Review } from "./review-listings";

const offer = (title: string, domain: string, priceCents: number, extra: Partial<Candidate> = {}): Candidate => ({ id: title, title, brands: ["Charmin"], imageUrl: null, url: `https://${domain}/${encodeURIComponent(title)}`, domain, department: null, priceCents, currency: "USD", inStock: true, condition: "new", ...extra });
const wanted: Wanted = { name: "Toilet Paper", unit: "rolls", category: null, brands: ["Charmin"], store: null, quantity: 12, range: { minCents: null, maxCents: 3000 }, canOrderFrom };
const six = offer("Toilet Paper", "walmart.com", 1112, { description: "Soft and strong. This Mega pack contains 6 rolls." });
const bare = offer("Charmin Toilet Paper", "amazon.com", 1400);
const bulk = offer("Charmin Toilet Paper Commercial", "lowes.com", 2900, { description: "96 rolls per case." });
const elsewhere = offer("Charmin Toilet Paper 12 Rolls", "cvs.com", 900);
const verdict = (n: number, is_the_product: boolean, units_in_listing: number | null) => ({ n, is_the_product, units_in_listing });
const answer = (overrides: Partial<Review>): Review => ({ listings: [], best: null, reason: null, safe_to_buy_without_asking: true, ...overrides });

describe("the rules without any AI", () => {
  it("read a pack size from the description when the title has none", () => {
    expect(packSizeFrom(six.description!, "rolls")).toBe(6);
    const [pick] = pickOffers([six], wanted);
    expect(pick).toMatchObject({ packSize: 6, packs: 2, totalCents: 2224, concerns: [] });
  });

  it("rank a store we can order from ahead of a cheaper one we can't, and mark that one", () => {
    const picks = pickOffers([elsewhere, six], wanted);
    expect(picks.map((p) => p.candidate.domain)).toEqual(["walmart.com", "cvs.com"]);
    expect(picks[1]!.concerns).toContain("not-orderable");
  });

  it("know Zinc's stores, with or without www", () => {
    expect(canOrderFrom("www.walmart.com")).toBe(true);
    expect(canOrderFrom("target.com")).toBe(false);
  });
});

describe("applyReview", () => {
  const picks = pickOffers([six, bare, bulk, elsewhere], wanted);
  const at = (candidate: Candidate) => listingsToReview(picks).findIndex((p) => p.candidate === candidate) + 1;

  it("puts its choice first with its reason, and uses the sizes it read", () => {
    const { picks: result, reason } = applyReview(picks, answer({ listings: [verdict(at(bare), true, 12)], best: at(bare), reason: "  Same brand,\n your usual 12 rolls. " }), wanted);
    expect(result[0]).toMatchObject({ candidate: bare, packSize: 12, packs: 1, totalCents: 1400, concerns: [] });
    expect(reason).toBe("Same brand, your usual 12 rolls.");
  });

  it("drops what it says isn't the product", () => {
    const { picks: result } = applyReview(picks, answer({ listings: [verdict(at(bulk), false, null)], best: at(six) }), wanted);
    expect(result.map((p) => p.candidate)).not.toContain(bulk);
  });

  it("can't get past the user's limits: concerns are worked out again", () => {
    // Called 1 roll a listing, it would take 12 packs, well over the $30 limit.
    const { picks: result } = applyReview(picks, answer({ listings: [verdict(at(bare), true, 1)], best: at(bare) }), wanted);
    expect(result[0]!.concerns).toContain("outside-price-range");
  });

  it("can't choose a store we can't order from, which never reaches it and stays a link at the end", () => {
    const { picks: result } = applyReview(picks, answer({ listings: [], best: at(six) }), wanted);
    expect(result.at(-1)).toMatchObject({ candidate: elsewhere });
    expect(reviewPrompt(wanted, listingsToReview(picks))).not.toContain("cvs.com");
  });

  it("trusts a size printed in the title over its reading, and flags the disagreement so auto-buy asks", () => {
    const titled = offer("Charmin Ultra Soft Toilet Paper, 18 Mega Rolls", "lowes.com", 1899);
    const list = pickOffers([titled], wanted);
    const { picks: result } = applyReview(list, answer({ listings: [verdict(1, true, 6)], best: 1 }), wanted);
    expect(result[0]).toMatchObject({ packSize: 18, packs: 1, totalCents: 1899 });
    expect(result[0]!.concerns).toContain("ai-unsure");
    expect(applyReview(list, answer({ listings: [verdict(1, true, 18)], best: 1 }), wanted).picks[0]!.concerns).not.toContain("ai-unsure");
  });

  it("ignores numbers that aren't listings, and silly sizes", () => {
    const { picks: result } = applyReview(picks, answer({ listings: [verdict(99, false, null), verdict(at(six), true, -3)], best: 99 }), wanted);
    expect(result).toHaveLength(picks.length);
    expect(result.find((p) => p.candidate === six)).toMatchObject({ packSize: 6 });
  });

  it("flags the top listing when it is unsure or chose none, so auto-buy asks, with no reason to show", () => {
    expect(applyReview(picks, answer({ best: at(six), safe_to_buy_without_asking: false }), wanted).picks[0]!.concerns).toContain("ai-unsure");
    const none = applyReview(picks, answer({ best: null, reason: "None fit" }), wanted);
    expect(none.picks[0]!.concerns).toContain("ai-unsure");
    expect(none.reason).toBeNull();
  });

  it("leaves only links when it rejects everything orderable", () => {
    const listings = listingsToReview(picks).map((_, i) => verdict(i + 1, false, null));
    const { picks: result } = applyReview(picks, answer({ listings }), wanted);
    expect(result.map((p) => p.candidate)).toEqual([elsewhere]);
  });
});

describe("reviewPrompt", () => {
  it("tells the model what they need and what each listing says", () => {
    const prompt = reviewPrompt(wanted, listingsToReview(pickOffers([six], wanted)));
    expect(prompt).toContain("They usually buy: 12 rolls.");
    expect(prompt).toContain("Brands they have bought: Charmin.");
    expect(prompt).toContain("This Mega pack contains 6 rolls.");
    expect(prompt).toContain("Price limit for the order: $30.00.");
  });
});
