import { GoogleGenAI } from "@google/genai";
import type { JsonModel } from "./ai-review";

/**
 * Chosen by trying the three cheapest on real listings (November 2026). gemini-2.5-flash-lite costs about a
 * quarter as much but guessed pack sizes the listings didn't state, and this decides how much gets ordered;
 * this one says it doesn't know. About $0.001 to $0.002 a call. AI_MODEL chooses another.
 */
export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";
// This runs in the scheduled job, so nobody is waiting, and answers took up to 12 seconds in testing.
const TIMEOUT_MS = 30_000;
/** Gemini answers 503 when it is busy, which passes quickly, so that is worth one more try. */
const RETRY_AFTER_MS = 3_000;
const isBusy = (error: unknown) => (error as { status?: number })?.status === 503;

/** Gemini from GEMINI_API_KEY, or null when it isn't set. */
export function geminiFromEnv(): JsonModel | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: TIMEOUT_MS } });
  return {
    async json({ system, prompt, schema }) {
      const ask = () =>
        client.models.generateContent({
          model: process.env.AI_MODEL?.trim() || GEMINI_DEFAULT_MODEL,
          contents: prompt,
          config: { systemInstruction: system, responseMimeType: "application/json", responseJsonSchema: schema },
        });
      const response = await ask().catch(async (error) => {
        if (!isBusy(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
        return ask();
      });
      if (!response.text) throw new Error("Gemini gave no answer");
      return JSON.parse(response.text);
    },
  };
}
