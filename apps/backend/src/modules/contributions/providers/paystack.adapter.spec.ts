import { ServiceUnavailableException } from "@nestjs/common";
import { PaystackAdapter } from "./paystack.adapter";
import { SettingsService } from "../../../common/settings/settings.service";

// verifyPayment() only — the pull-side check reconcileForFounder /
// VaultContributionsService.reconcile rely on. fetch is stubbed per test,
// so no real call ever reaches Paystack.
describe("PaystackAdapter.verifyPayment()", () => {
  const realFetch = global.fetch;
  const settingsWithKey = { get: async () => "sk_test_fake" } as unknown as SettingsService;

  function stubFetch(status: number, body: unknown) {
    const calls: string[] = [];
    global.fetch = (async (url: string) => {
      calls.push(url);
      return { ok: status >= 200 && status < 300, status, statusText: "stub", json: async () => body } as Response;
    }) as typeof fetch;
    return calls;
  }

  afterEach(() => {
    global.fetch = realFetch;
  });

  test("a successful transaction → confirmed, with Paystack's own amount (kobo), currency and id", async () => {
    const calls = stubFetch(200, { status: true, data: { id: 42, status: "success", reference: "ref-1", amount: 37500000, currency: "ngn" } });
    const adapter = new PaystackAdapter(settingsWithKey);

    expect(await adapter.verifyPayment("ref-1")).toEqual({
      status: "confirmed",
      amountMinorUnits: 37500000,
      currency: "NGN",
      providerPaymentId: "42",
    });
    expect(calls[0]).toBe("https://api.paystack.co/transaction/verify/ref-1");
  });

  test.each([
    ["failed", "failed"],
    ["reversed", "failed"],
    ["abandoned", "pending"],
    ["ongoing", "pending"],
    ["pending", "pending"],
  ])("Paystack status %s → %s", async (paystackStatus, expected) => {
    stubFetch(200, { status: true, data: { id: 1, status: paystackStatus, reference: "r", amount: 100, currency: "NGN" } });
    const adapter = new PaystackAdapter(settingsWithKey);
    expect((await adapter.verifyPayment("r"))?.status).toBe(expected);
  });

  test("an unknown reference (404) → null", async () => {
    stubFetch(404, { status: false, message: "Transaction reference not found" });
    const adapter = new PaystackAdapter(settingsWithKey);
    expect(await adapter.verifyPayment("nope")).toBeNull();
  });

  test("any other error response throws rather than guessing a state", async () => {
    stubFetch(500, { status: false, message: "Server error" });
    const adapter = new PaystackAdapter(settingsWithKey);
    await expect(adapter.verifyPayment("r")).rejects.toThrow("Paystack transaction verify failed");
  });

  test("no secret key configured → 503, and Paystack is never called", async () => {
    const calls = stubFetch(200, {});
    const adapter = new PaystackAdapter({ get: async () => null } as unknown as SettingsService);
    await expect(adapter.verifyPayment("r")).rejects.toThrow(ServiceUnavailableException);
    expect(calls).toHaveLength(0);
  });
});
