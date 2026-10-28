import { describe, expect, it, vi } from "vitest";
import { ExtractionError } from "../../types";
import { createGoogleVisionEngine } from "./google-vision";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const vertices = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const image = new Uint8Array([1, 2, 3]);

describe("createGoogleVisionEngine", () => {
  it("sends the photo with the key in a header, and returns the words with their geometry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        responses: [
          {
            textAnnotations: [
              { description: "MILK 3.98" },
              { description: "MILK", boundingPoly: { vertices: vertices(10, 20, 40, 10) } },
              // Vision leaves out a coordinate that is 0.
              { description: "3.98", boundingPoly: { vertices: [{ y: 20 }, { x: 40, y: 20 }, { x: 40, y: 30 }, { y: 30 }] } },
            ],
          },
        ],
      }),
    );
    const engine = createGoogleVisionEngine({ apiKey: "secret-key", fetch: fetchMock });

    const result = await engine.read(image);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain("secret-key");
    expect(init.headers["x-goog-api-key"]).toBe("secret-key");
    const body = JSON.parse(init.body);
    expect(body.requests[0].image.content).toBe(Buffer.from(image).toString("base64"));
    expect(body.requests[0].features).toEqual([{ type: "DOCUMENT_TEXT_DETECTION" }]);

    expect(result.text).toBe("MILK 3.98");
    expect(result.words).toEqual([
      { text: "MILK", cx: 30, cy: 25, width: 40, height: 10, angle: 0 },
      { text: "3.98", cx: 20, cy: 25, width: 40, height: 10, angle: 0 },
    ]);
  });

  it("reports the direction rotated text runs in", async () => {
    // Text running straight down the image: top-left vertex first, then down.
    const down = [
      { x: 50, y: 10 },
      { x: 50, y: 50 },
      { x: 30, y: 50 },
      { x: 30, y: 10 },
    ];
    const engine = createGoogleVisionEngine({
      apiKey: "k",
      fetch: vi.fn().mockResolvedValue(
        json({ responses: [{ textAnnotations: [{ description: "x" }, { description: "ABC", boundingPoly: { vertices: down } }] }] }),
      ),
    });
    const [word] = (await engine.read(image)).words;
    expect(word.angle).toBeCloseTo(Math.PI / 2);
    expect(word.width).toBe(40);
    expect(word.height).toBe(20);
  });

  it("returns no words for a photo with no text", async () => {
    const engine = createGoogleVisionEngine({ apiKey: "k", fetch: vi.fn().mockResolvedValue(json({ responses: [{}] })) });
    expect(await engine.read(image)).toEqual({ text: "", words: [] });
  });

  it("explains a missing key", async () => {
    vi.stubEnv("GOOGLE_VISION_API_KEY", "");
    const engine = createGoogleVisionEngine({ fetch: vi.fn() });
    await expect(engine.read(image)).rejects.toThrow(/GOOGLE_VISION_API_KEY/);
    vi.unstubAllEnvs();
  });

  it("reads the key from the environment when none is given", async () => {
    vi.stubEnv("GOOGLE_VISION_API_KEY", "from-env");
    const fetchMock = vi.fn().mockResolvedValue(json({ responses: [{}] }));
    await createGoogleVisionEngine({ fetch: fetchMock }).read(image);
    expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe("from-env");
    vi.unstubAllEnvs();
  });

  it.each([
    [400, "API key not valid. Please pass a valid API key.", /rejected the API key/],
    [403, "Cloud Vision API has not been used in project 1 before.", /Cloud Vision API has not been used in project 1 before\. Check that the Cloud Vision API is enabled/],
    [429, "Quota exceeded", /rate limiting/],
    [500, "Internal error", /failed \(500\).*Internal error/],
  ])("turns a %i from Google into an error written for the user", async (status, message, expected) => {
    const engine = createGoogleVisionEngine({
      apiKey: "k",
      fetch: vi.fn().mockResolvedValue(json({ error: { code: status, message } }, status)),
    });
    const error = await engine.read(image).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionError);
    expect((error as Error).message).toMatch(expected);
  });

  it("reports an error Google puts inside an otherwise successful response", async () => {
    const engine = createGoogleVisionEngine({
      apiKey: "k",
      fetch: vi.fn().mockResolvedValue(json({ responses: [{ error: { code: 3, message: "Bad image data." } }] })),
    });
    await expect(engine.read(image)).rejects.toThrow(/Bad image data/);
  });

  it("reports an unreachable network", async () => {
    const engine = createGoogleVisionEngine({ apiKey: "k", fetch: vi.fn().mockRejectedValue(new TypeError("fetch failed")) });
    await expect(engine.read(image)).rejects.toThrow(/Couldn't reach Google Vision/);
  });
});
