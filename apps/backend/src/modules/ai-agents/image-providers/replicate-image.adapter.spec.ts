import { ServiceUnavailableException } from "@nestjs/common";
import { ReplicateImageAdapter } from "./replicate-image.adapter";
import { SettingsService } from "../../../common/settings/settings.service";

const API_KEY = "r8-fixture-key";
const POLL_URL = "https://api.replicate.com/v1/predictions/fixture-id";

function fakeSettings(key: string | undefined = API_KEY): SettingsService {
  return { get: async () => key } as unknown as SettingsService;
}

describe("ReplicateImageAdapter", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Explicit timeout — same reasoning as openai-image.adapter.spec.ts's
  // own comment on this: first-test-in-worker ts-jest cold-start cost,
  // not a hang.
  test(
    "throws when no API key is configured",
    async () => {
      const adapter = new ReplicateImageAdapter(fakeSettings(undefined));
      await expect(adapter.generate("a waqf")).rejects.toThrow(ServiceUnavailableException);
    },
    15000,
  );

  test("creates a prediction, polls until it succeeds, then fetches the output image", async () => {
    const pngBytes = Buffer.from("fixture-replicate-png-bytes");
    let pollCount = 0;
    global.fetch = jest.fn(async (url: any) => {
      if (String(url) === "https://api.replicate.com/v1/predictions") {
        return {
          ok: true,
          json: async () => ({ id: "fixture-id", status: "starting", urls: { get: POLL_URL } }),
        } as any;
      }
      if (String(url) === POLL_URL) {
        pollCount += 1;
        // "processing" once, then "succeeded" — exercises the actual poll loop, not just a single-shot success.
        if (pollCount === 1) {
          return { ok: true, json: async () => ({ id: "fixture-id", status: "processing", urls: { get: POLL_URL } }) } as any;
        }
        return { ok: true, json: async () => ({ id: "fixture-id", status: "succeeded", output: ["https://cdn.example.test/out.png"], urls: { get: POLL_URL } }) } as any;
      }
      if (String(url) === "https://cdn.example.test/out.png") {
        return { ok: true, arrayBuffer: async () => pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength) } as any;
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    }) as any;

    const adapter = new ReplicateImageAdapter(fakeSettings());
    const result = await adapter.generate("a waqf");
    expect(result).toEqual(pngBytes);
    expect(pollCount).toBe(2);
  }, 10000);

  test("throws when the prediction fails", async () => {
    global.fetch = jest.fn(async (url: any) => {
      if (String(url) === "https://api.replicate.com/v1/predictions") {
        return { ok: true, json: async () => ({ id: "fixture-id", status: "starting", urls: { get: POLL_URL } }) } as any;
      }
      return { ok: true, json: async () => ({ id: "fixture-id", status: "failed", error: "NSFW content detected", urls: { get: POLL_URL } }) } as any;
    }) as any;

    const adapter = new ReplicateImageAdapter(fakeSettings());
    await expect(adapter.generate("a waqf")).rejects.toThrow("NSFW content detected");
  }, 10000);

  test("throws when starting the prediction itself fails", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, statusText: "Unauthorized", json: async () => null })) as any;
    const adapter = new ReplicateImageAdapter(fakeSettings());
    await expect(adapter.generate("a waqf")).rejects.toThrow(ServiceUnavailableException);
  });
});
