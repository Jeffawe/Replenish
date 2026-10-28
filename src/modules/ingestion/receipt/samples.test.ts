import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestResult } from "@/core/purchase-batch";
import { createSampleStore, samplesFolder, type ReadSample } from "./samples";

const NOW = new Date("2026-10-28T10:00:00Z");
const RESULT: IngestResult = { status: "processed", items: [] };

const read = (id = "0123456789abcdef"): ReadSample => ({
  id,
  photo: new Uint8Array([1, 2, 3]),
  mimeType: "image/jpeg",
  ocr: { text: "MILK 3.98", words: [] },
  outcome: { kind: "skipped", reason: "nothing to record" },
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "samples-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("test samples", () => {
  it("keeps the photo, the OCR and the draft in a folder named for the photo", async () => {
    await createSampleStore(dir, () => NOW).saveRead(read());

    expect((await readdir(join(dir, "0123456789abcdef"))).sort()).toEqual(["draft.json", "ocr.json", "photo.jpg"]);
    expect([...(await readFile(join(dir, "0123456789abcdef", "photo.jpg")))]).toEqual([1, 2, 3]);
    expect(JSON.parse(await readFile(join(dir, "0123456789abcdef", "draft.json"), "utf8"))).toEqual({
      readAt: "2026-10-28T10:00:00.000Z",
      kind: "skipped",
      reason: "nothing to record",
    });
  });

  it("keeps what the user confirmed next to the photo it came from", async () => {
    const store = createSampleStore(dir, () => NOW);
    await store.saveRead(read());
    await store.saveConfirmed("receipt-photo:0123456789abcdef", { batch: { store: "Walmart" }, review: { skipped: [] }, result: RESULT });

    const confirmed = JSON.parse(await readFile(join(dir, "0123456789abcdef", "confirmed.json"), "utf8"));
    expect(confirmed).toMatchObject({ confirmedAt: "2026-10-28T10:00:00.000Z", batch: { store: "Walmart" }, result: RESULT });
  });

  it("only keeps a confirmation for a photo it has read", async () => {
    await createSampleStore(dir).saveConfirmed("receipt-photo:0123456789abcdef", { batch: {}, result: RESULT });
    expect(await readdir(dir)).toEqual([]);
  });

  it("never writes outside its folder, whatever it is asked to name", async () => {
    const store = createSampleStore(dir);
    await store.saveRead(read("../../escape"));
    await store.saveConfirmed("receipt-photo:../../escape", { batch: {}, result: RESULT });
    await store.saveConfirmed("email:abc", { batch: {}, result: RESULT });
    expect(await readdir(dir)).toEqual([]);
  });

  it("reports a failure instead of throwing, so a receipt is never lost to a full disk", async () => {
    const file = join(dir, "not-a-folder");
    await writeFile(file, "");
    const onError = vi.fn();

    await expect(createSampleStore(file, () => NOW, onError).saveRead(read())).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("the configured samples folder", () => {
  it("expands ~ to the home folder, so one setting works on any machine", () => {
    expect(samplesFolder("~/replenish-samples", "/home/jeff")).toBe("/home/jeff/replenish-samples");
    expect(samplesFolder("~", "/home/jeff")).toBe("/home/jeff");
  });

  it("leaves other paths alone", () => {
    expect(samplesFolder("/srv/samples", "/home/jeff")).toBe("/srv/samples");
    expect(samplesFolder("~jeff/samples", "/home/jeff")).toMatch(/~jeff\/samples$/);
  });
});
