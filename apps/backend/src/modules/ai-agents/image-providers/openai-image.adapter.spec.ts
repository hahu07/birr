import { ServiceUnavailableException } from "@nestjs/common";
import { OpenAiImageAdapter } from "./openai-image.adapter";
import { SettingsService } from "../../../common/settings/settings.service";

const API_KEY = "sk-fixture-key";

/** No DB involvement needed for an adapter-level unit test — same
 * "fake cast as the real class" pattern as paystack-payout.adapter.spec.ts. */
function fakeSettings(key: string | undefined = API_KEY): SettingsService {
  return { get: async () => key } as unknown as SettingsService;
}

describe("OpenAiImageAdapter", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Explicit timeout: this test is trivial (rejects before ever calling
  // fetch), but being the first test in a freshly-spun-up Jest worker,
  // ts-jest's own cold-start compilation cost can push it past the 5s
  // default on a loaded machine — same reasoning as the explicit
  // timeouts on the MFA specs' own slow tests, confirmed repeatedly this
  // session, not a hang.
  test(
    "throws when no API key is configured",
    async () => {
      const adapter = new OpenAiImageAdapter(fakeSettings(undefined));
      await expect(adapter.generate("a waqf")).rejects.toThrow(ServiceUnavailableException);
    },
    15000,
  );

  test("decodes a b64_json response directly", async () => {
    const pngBytes = Buffer.from("fixture-png-bytes");
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ b64_json: pngBytes.toString("base64") }] }),
    })) as any;

    const adapter = new OpenAiImageAdapter(fakeSettings());
    const result = await adapter.generate("a waqf");
    expect(result).toEqual(pngBytes);
  });

  test("fetches the image when the response returns a url instead", async () => {
    const pngBytes = Buffer.from("fixture-png-bytes-from-url");
    global.fetch = jest.fn(async (url: any) => {
      if (String(url) === "https://api.openai.com/v1/images/generations") {
        return { ok: true, json: async () => ({ data: [{ url: "https://cdn.example.test/image.png" }] }) } as any;
      }
      if (String(url) === "https://cdn.example.test/image.png") {
        return { ok: true, arrayBuffer: async () => pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength) } as any;
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    }) as any;

    const adapter = new OpenAiImageAdapter(fakeSettings());
    const result = await adapter.generate("a waqf");
    expect(result).toEqual(pngBytes);
  });

  test("throws with the API's own error message on a non-ok response", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      statusText: "Bad Request",
      json: async () => ({ error: { message: "Invalid prompt" } }),
    })) as any;

    const adapter = new OpenAiImageAdapter(fakeSettings());
    await expect(adapter.generate("a waqf")).rejects.toThrow("Invalid prompt");
  });

  test("throws when the response has no image data at all", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: [{}] }) })) as any;
    const adapter = new OpenAiImageAdapter(fakeSettings());
    await expect(adapter.generate("a waqf")).rejects.toThrow("no image data");
  });
});
