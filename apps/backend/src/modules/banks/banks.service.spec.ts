import { ServiceUnavailableException } from "@nestjs/common";
import { BanksService } from "./banks.service";
import { SettingsService } from "../../common/settings/settings.service";

// No DB/prisma involvement needed for this service — it only ever talks
// to SettingsService.get() and the Paystack HTTP API. Same "fake cast as
// the real class" + global.fetch mocking pattern already established by
// PaystackPayoutAdapter's own spec.
function fakeSettings(secretKey: string | null): SettingsService {
  return { get: async () => secretKey } as unknown as SettingsService;
}

describe("BanksService", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("throws ServiceUnavailableException when no Paystack secret key is configured", async () => {
    const service = new BanksService(fakeSettings(null));
    await expect(service.listNigerianBanks()).rejects.toThrow(ServiceUnavailableException);
  });

  test("filters to active NGN banks, maps to {name, code}, and sorts by name", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        status: true,
        data: [
          { name: "Zenith Bank", code: "057", active: true, country: "Nigeria", currency: "NGN" },
          { name: "Access Bank", code: "044", active: true, country: "Nigeria", currency: "NGN" },
          { name: "Inactive Bank", code: "999", active: false, country: "Nigeria", currency: "NGN" },
          { name: "Foreign Currency Bank", code: "888", active: true, country: "Nigeria", currency: "USD" },
        ],
      }),
    })) as any;

    const service = new BanksService(fakeSettings("sk_test_fixture"));
    const banks = await service.listNigerianBanks();

    expect(banks).toEqual([
      { name: "Access Bank", code: "044" },
      { name: "Zenith Bank", code: "057" },
    ]);
  });

  test("throws when the Paystack response itself reports failure", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({ status: false, message: "Invalid key" }),
    })) as any;

    const service = new BanksService(fakeSettings("sk_test_fixture"));
    await expect(service.listNigerianBanks()).rejects.toThrow("Paystack list banks failed");
  });

  // Regression coverage for a real duplicate-key React error found live
  // (2026-09-29): Paystack's own bank list carries a handful of entries
  // sharing one code under two names, and the Founder Portal's bank
  // Combobox keys its options by code — two entries with the same code
  // broke it. First-seen wins; which name survives is arbitrary since
  // both codes route to the same account either way.
  test("dedupes by code, keeping the first name seen for a shared code", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        status: true,
        data: [
          { name: "BANKIT MFB", code: "50572", active: true, country: "Nigeria", currency: "NGN" },
          { name: "BANKIT MICROFINANCE BANK LTD", code: "50572", active: true, country: "Nigeria", currency: "NGN" },
          { name: "Zenith Bank", code: "057", active: true, country: "Nigeria", currency: "NGN" },
        ],
      }),
    })) as any;

    const service = new BanksService(fakeSettings("sk_test_fixture"));
    const banks = await service.listNigerianBanks();

    expect(banks).toEqual([{ name: "BANKIT MFB", code: "50572" }, { name: "Zenith Bank", code: "057" }]);
  });

  // Regression coverage for a gap flagged in the 2026-09-26 audit: this
  // service had no spec at all. Its entire reason to cache (see
  // CACHE_TTL_MS's own comment) is avoiding a live Paystack call on every
  // beneficiary form render — worth proving directly, not just trusting
  // the comment.
  test("caches the result — a second call within the TTL doesn't hit Paystack again", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        status: true,
        data: [{ name: "GTBank", code: "058", active: true, country: "Nigeria", currency: "NGN" }],
      }),
    }));
    global.fetch = fetchMock as any;

    const service = new BanksService(fakeSettings("sk_test_fixture"));
    const first = await service.listNigerianBanks();
    const second = await service.listNigerianBanks();

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
