import { ScreenShieldAdapter } from "./screenshield.adapter";
import { SettingsService } from "../../../common/settings/settings.service";

/** No DB/prisma involvement needed for an adapter-level unit test —
 * same "fake cast as the real class" pattern as
 * paystack-payout.adapter.spec.ts's own fakeSettings(). */
function fakeSettings(values: Record<string, string | undefined>): SettingsService {
  return { get: async (_provider: string, key: string) => values[key] } as unknown as SettingsService;
}

describe("ScreenShieldAdapter", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("resolves to status: error (never throws) when the API key is unset", async () => {
    const adapter = new ScreenShieldAdapter(fakeSettings({ BASE_URL: "https://api.screenshield.example/v1" }));
    const result = await adapter.screen({ name: "Test Subject" });
    expect(result.status).toBe("error");
  });

  test("resolves to status: error (never throws) when the base URL is unset", async () => {
    const adapter = new ScreenShieldAdapter(fakeSettings({ API_KEY: "sk_test_fixture" }));
    const result = await adapter.screen({ name: "Test Subject" });
    expect(result.status).toBe("error");
  });

  test("parses a match response as a hit, sending the name/country and bearer auth", async () => {
    const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ match: true, matches: [{ list: "OFAC" }] }) } as any;
    }) as any;

    const adapter = new ScreenShieldAdapter(fakeSettings({ API_KEY: "sk_test_fixture", BASE_URL: "https://api.screenshield.example/v1" }));
    const result = await adapter.screen({ name: "Osama Fixture", country: "NG" });

    expect(result.status).toBe("hit");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.screenshield.example/v1/screen");
    expect(calls[0]!.headers.Authorization).toBe("Bearer sk_test_fixture");
    expect(calls[0]!.body).toEqual({ name: "Osama Fixture", country: "NG" });
  });

  test("parses a no-match response as clear", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ match: false }) }) as any) as any;
    const adapter = new ScreenShieldAdapter(fakeSettings({ API_KEY: "sk_test_fixture", BASE_URL: "https://api.screenshield.example/v1" }));
    const result = await adapter.screen({ name: "Clean Fixture" });
    expect(result.status).toBe("clear");
  });

  test("resolves to status: error on a non-2xx response, never throwing", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }) as any) as any;
    const adapter = new ScreenShieldAdapter(fakeSettings({ API_KEY: "sk_test_fixture", BASE_URL: "https://api.screenshield.example/v1" }));
    const result = await adapter.screen({ name: "Fixture" });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errorMessage).toContain("500");
  });

  test("resolves to status: error on a network failure, never throwing", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as any;
    const adapter = new ScreenShieldAdapter(fakeSettings({ API_KEY: "sk_test_fixture", BASE_URL: "https://api.screenshield.example/v1" }));
    const result = await adapter.screen({ name: "Fixture" });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errorMessage).toBe("ECONNREFUSED");
  });
});
