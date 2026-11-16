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

// createPayment()'s subaccount split — what keeps zakah out of Birr's
// main account. fetch is stubbed; nothing reaches Paystack.
describe("PaystackAdapter.createPayment() with a split", () => {
  const realFetch = global.fetch;
  const settingsWithKey = { get: async () => "sk_test_fake" } as unknown as SettingsService;
  let sentBody: Record<string, unknown>;

  beforeEach(() => {
    global.fetch = (async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 200,
        statusText: "stub",
        json: async () => ({ status: true, data: { reference: "ref-z", authorization_url: "https://checkout.paystack.com/x" } }),
      } as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  test("sends the subaccount, the main account's flat share, and makes the main account bear the fee", async () => {
    const adapter = new PaystackAdapter(settingsWithKey);
    await adapter.createPayment({
      amount: "96548.23",
      currency: "NGN",
      reference: "ref-z",
      returnPath: "zakah-payments",
      split: { subaccount: "ACCT_zakah", mainAccountShareMinorUnits: 154823 },
    });

    expect(sentBody).toMatchObject({
      amount: 9654823,
      currency: "NGN",
      subaccount: "ACCT_zakah",
      transaction_charge: 154823,
      bearer: "account",
    });
    expect(sentBody.callback_url).toMatch(/\/zakah-payments\/ref-z$/);
  });

  test("sends no split fields when none is asked for", async () => {
    const adapter = new PaystackAdapter(settingsWithKey);
    await adapter.createPayment({ amount: "500", currency: "NGN", reference: "ref-v" });

    expect(sentBody).not.toHaveProperty("subaccount");
    expect(sentBody).not.toHaveProperty("transaction_charge");
    expect(sentBody).not.toHaveProperty("bearer");
  });
});

// Monthly giving (RecurringGift): the card-only checkout, reading the card
// back, and charging it. fetch is stubbed; nothing reaches Paystack.
describe("PaystackAdapter monthly giving", () => {
  const realFetch = global.fetch;
  const settingsWithKey = { get: async () => "sk_test_fake" } as unknown as SettingsService;

  function stubFetch(status: number, body: unknown) {
    const calls: { url: string; body: Record<string, unknown> | null }[] = [];
    global.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      return { ok: status >= 200 && status < 300, status, statusText: "stub", json: async () => body } as Response;
    }) as typeof fetch;
    return calls;
  }

  afterEach(() => {
    global.fetch = realFetch;
  });

  test("a monthly gift's first checkout is limited to cards", async () => {
    const calls = stubFetch(200, { status: true, data: { authorization_url: "https://checkout.paystack.com/x", access_code: "x", reference: "ref-1" } });
    await new PaystackAdapter(settingsWithKey).createPayment({ amount: "250000", currency: "NGN", reference: "ref-1", payerEmail: "a@example.com", cardOnly: true });
    expect(calls[0].body).toMatchObject({ channels: ["card"], amount: 25000000 });
  });

  test("a one-off checkout offers every channel", async () => {
    const calls = stubFetch(200, { status: true, data: { authorization_url: "u", access_code: "x", reference: "ref-2" } });
    await new PaystackAdapter(settingsWithKey).createPayment({ amount: "250000", currency: "NGN", reference: "ref-2" });
    expect(calls[0].body).not.toHaveProperty("channels");
  });

  test("verifying a card payment reads back the card Paystack can charge again", async () => {
    stubFetch(200, {
      status: true,
      data: {
        id: 7, status: "success", reference: "r", amount: 100, currency: "NGN",
        authorization: { authorization_code: "AUTH_abc", reusable: true, channel: "card", last4: "4081", brand: "visa ", exp_month: "12", exp_year: "2030" },
      },
    });
    expect((await new PaystackAdapter(settingsWithKey).verifyPayment("r"))?.authorization).toEqual({
      authorizationCode: "AUTH_abc", reusable: true, channel: "card", last4: "4081", brand: "visa", expMonth: 12, expYear: 2030,
    });
  });

  test("charging a saved card sends our reference, the card and the email it was saved under", async () => {
    const calls = stubFetch(200, { status: true, data: { id: 9, status: "success", reference: "ref-3", gateway_response: "Approved" } });
    const result = await new PaystackAdapter(settingsWithKey).chargeSavedCard({
      authorizationCode: "AUTH_abc", email: "a@example.com", amount: "250000.50", currency: "ngn", reference: "ref-3",
    });
    expect(result).toEqual({ status: "confirmed", providerPaymentId: "9", gatewayResponse: "Approved" });
    expect(calls[0].url).toBe("https://api.paystack.co/transaction/charge_authorization");
    expect(calls[0].body).toEqual({ email: "a@example.com", amount: 25000050, currency: "NGN", authorization_code: "AUTH_abc", reference: "ref-3" });
  });

  test("a declined card is a failed charge with Paystack's reason, not an error", async () => {
    stubFetch(200, { status: true, data: { id: 10, status: "failed", reference: "r", gateway_response: "Insufficient Funds" } });
    expect(await new PaystackAdapter(settingsWithKey).chargeSavedCard({ authorizationCode: "A", email: "e", amount: "1", currency: "NGN", reference: "r" })).toMatchObject({
      status: "failed",
      gatewayResponse: "Insufficient Funds",
    });
  });

  test("a refused authorisation is a declined charge; Paystack being down is an error", async () => {
    stubFetch(400, { status: false, message: "Invalid authorization code" });
    const adapter = new PaystackAdapter(settingsWithKey);
    expect(await adapter.chargeSavedCard({ authorizationCode: "A", email: "e", amount: "1", currency: "NGN", reference: "r" })).toEqual({
      status: "failed",
      gatewayResponse: "Invalid authorization code",
    });
    stubFetch(503, { status: false, message: "Service unavailable" });
    await expect(adapter.chargeSavedCard({ authorizationCode: "A", email: "e", amount: "1", currency: "NGN", reference: "r" })).rejects.toThrow(
      "Paystack charge_authorization failed",
    );
  });

  test("the zakah subaccount split carries over to a saved-card charge", async () => {
    const calls = stubFetch(200, { status: true, data: { id: 11, status: "success", reference: "r" } });
    await new PaystackAdapter(settingsWithKey).chargeSavedCard({
      authorizationCode: "A", email: "e", amount: "1000", currency: "NGN", reference: "r",
      split: { subaccount: "ACCT_zakah", mainAccountShareMinorUnits: 2500 },
    });
    expect(calls[0].body).toMatchObject({ subaccount: "ACCT_zakah", transaction_charge: 2500, bearer: "account" });
  });
});
