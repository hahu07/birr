import { createHmac } from "crypto";
import { PaystackPayoutAdapter } from "./paystack-payout.adapter";
import { SettingsService } from "../../../common/settings/settings.service";

const SECRET_KEY = "sk_test_fixture_secret";

/** No DB/prisma involvement needed for an adapter-level unit test —
 * a minimal fake standing in for SettingsService.get, same "fake cast as
 * the real class" pattern used elsewhere in this codebase's specs. */
function fakeSettings(): SettingsService {
  return { get: async () => SECRET_KEY } as unknown as SettingsService;
}

function signedBody(payload: unknown): { rawBody: Buffer; signature: string } {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = createHmac("sha512", SECRET_KEY).update(rawBody).digest("hex");
  return { rawBody, signature };
}

describe("PaystackPayoutAdapter", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("verifyAndParseWebhook", () => {
    const adapter = new PaystackPayoutAdapter(fakeSettings());

    test("rejects a missing signature", async () => {
      const { rawBody } = signedBody({ event: "transfer.success", data: { reference: "abc" } });
      const result = await adapter.verifyAndParseWebhook(rawBody, {});
      expect(result).toBeNull();
    });

    test("rejects an invalid signature", async () => {
      const { rawBody } = signedBody({ event: "transfer.success", data: { reference: "abc" } });
      const result = await adapter.verifyAndParseWebhook(rawBody, { "x-paystack-signature": "0".repeat(128) });
      expect(result).toBeNull();
    });

    test("parses transfer.success as paid", async () => {
      const { rawBody, signature } = signedBody({ event: "transfer.success", data: { reference: "dist-1" } });
      const result = await adapter.verifyAndParseWebhook(rawBody, { "x-paystack-signature": signature });
      expect(result).toEqual({ providerReference: "dist-1", status: "paid" });
    });

    test("parses transfer.failed and transfer.reversed as failed", async () => {
      for (const event of ["transfer.failed", "transfer.reversed"]) {
        const { rawBody, signature } = signedBody({ event, data: { reference: "dist-2" } });
        const result = await adapter.verifyAndParseWebhook(rawBody, { "x-paystack-signature": signature });
        expect(result).toEqual({ providerReference: "dist-2", status: "failed" });
      }
    });

    test("returns null (not a rejection) for a signature-valid but unrelated event, so the caller can fall through to the charge.* parser", async () => {
      const { rawBody, signature } = signedBody({ event: "charge.success", data: { reference: "irrelevant" } });
      const result = await adapter.verifyAndParseWebhook(rawBody, { "x-paystack-signature": signature });
      expect(result).toBeNull();
    });

    test("returns null for malformed JSON", async () => {
      const rawBody = Buffer.from("not json");
      const signature = createHmac("sha512", SECRET_KEY).update(rawBody).digest("hex");
      const result = await adapter.verifyAndParseWebhook(rawBody, { "x-paystack-signature": signature });
      expect(result).toBeNull();
    });
  });

  describe("createPayout", () => {
    const bankDetails = { bankName: "Test Bank", accountNumber: "0123456789", accountName: "Test Beneficiary", bankCode: "058" };

    test("rejects when the beneficiary's bank details are missing a bank code", async () => {
      const adapter = new PaystackPayoutAdapter(fakeSettings());
      await expect(
        adapter.createPayout({ amount: "10", currency: "NGN", reference: "dist-3", bankDetails: { ...bankDetails, bankCode: undefined } }),
      ).rejects.toThrow("missing a bank code");
    });

    test("creates a transfer recipient then initiates a transfer, returning the reference as providerReference", async () => {
      const calls: { url: string; body: unknown }[] = [];
      global.fetch = jest.fn(async (url: any, init: any) => {
        const body = JSON.parse(init.body);
        calls.push({ url: String(url), body });
        if (String(url).endsWith("/transferrecipient")) {
          return { ok: true, json: async () => ({ status: true, data: { recipient_code: "RCP_test" } }) } as any;
        }
        if (String(url).endsWith("/transfer")) {
          return { ok: true, json: async () => ({ status: true }) } as any;
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      }) as any;

      const adapter = new PaystackPayoutAdapter(fakeSettings());
      const result = await adapter.createPayout({ amount: "10.50", currency: "NGN", reference: "dist-4", bankDetails });

      expect(result).toEqual({ providerReference: "dist-4" });
      expect(calls).toHaveLength(2);
      expect(calls[0]!.body).toMatchObject({ type: "nuban", account_number: "0123456789", bank_code: "058" });
      expect(calls[1]!.body).toMatchObject({ recipient: "RCP_test", amount: 1050, reference: "dist-4" });
    });

    test("throws when recipient creation fails", async () => {
      global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ status: false, message: "Invalid bank code" }) }) as any) as any;
      const adapter = new PaystackPayoutAdapter(fakeSettings());
      await expect(
        adapter.createPayout({ amount: "10", currency: "NGN", reference: "dist-5", bankDetails }),
      ).rejects.toThrow("Paystack transfer recipient creation failed");
    });

    test("throws when transfer initiation fails", async () => {
      global.fetch = jest.fn(async (url: any) => {
        if (String(url).endsWith("/transferrecipient")) {
          return { ok: true, json: async () => ({ status: true, data: { recipient_code: "RCP_test" } }) } as any;
        }
        return { ok: false, json: async () => ({ status: false, message: "Insufficient balance" }) } as any;
      }) as any;
      const adapter = new PaystackPayoutAdapter(fakeSettings());
      await expect(
        adapter.createPayout({ amount: "10", currency: "NGN", reference: "dist-6", bankDetails }),
      ).rejects.toThrow("Paystack transfer initiation failed");
    });
  });
});
