import { afterEach, describe, expect, it, vi } from "vitest";
import { canOrderFrom, pickOffers, type Candidate, type Wanted } from "@/core/pick-offer";
import { createListingReviewer, modelFromEnv, type JsonModel } from "./ai-review";

const offer = (title: string, priceCents: number): Candidate => ({ id: title, title, brands: [], imageUrl: null, url: `https://walmart.com/${encodeURIComponent(title)}`, domain: "walmart.com", department: null, priceCents, currency: "USD", inStock: true, condition: "new" });
const wanted: Wanted = { name: "Toilet Paper", unit: "rolls", category: null, brands: [], store: null, quantity: 12, range: { minCents: null, maxCents: null }, canOrderFrom };
const picks = pickOffers([offer("Toilet Paper 12 Rolls", 900), offer("Toilet Paper 12 Rolls Plus", 1000)], wanted);
const replying = (answer: unknown): JsonModel => ({ json: vi.fn(async () => answer) });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("createListingReviewer", () => {
  it("asks with a JSON schema and returns the reviewed listings", async () => {
    const model = replying({ listings: [], best: 2, reason: "A better fit.", safe_to_buy_without_asking: true });
    const result = await createListingReviewer(model).review(wanted, picks);
    expect(result?.picks[0]!.candidate.title).toBe("Toilet Paper 12 Rolls Plus");
    expect(result?.reason).toBe("A better fit.");
    const [request] = (model.json as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(request.schema).toMatchObject({ type: "object" });
    expect(request.schema.$schema).toBeUndefined();
  });

  it("gives no answer, without throwing, when the model fails or talks nonsense", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await createListingReviewer({ json: async () => { throw new Error("down"); } }).review(wanted, picks)).toBeNull();
    expect(await createListingReviewer(replying({ nonsense: true })).review(wanted, picks)).toBeNull();
  });

  it("doesn't call the model with nothing it could choose", async () => {
    const model = replying({});
    expect(await createListingReviewer(model).review(wanted, [])).toBeNull();
    expect(model.json).not.toHaveBeenCalled();
  });
});

describe("modelFromEnv", () => {
  it("is off without a key, when turned off, and for a provider we don't know", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(modelFromEnv()).toBeNull();
    vi.stubEnv("GEMINI_API_KEY", "a-key");
    expect(modelFromEnv()).not.toBeNull();
    vi.stubEnv("AI_REVIEW", "off");
    expect(modelFromEnv()).toBeNull();
    vi.stubEnv("AI_REVIEW", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("AI_PROVIDER", "nobody");
    expect(modelFromEnv()).toBeNull();
  });
});
