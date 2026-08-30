import {
  CreatePayoutInput,
  CreatePayoutResult,
  PayoutProviderAdapter,
  PayoutWebhookResult,
} from "../providers/payout-provider.interface";

/**
 * A fake PaystackPayoutAdapter for specs that need DistributionsService
 * wired up without making real HTTP calls to Paystack — same "fake
 * adapter cast as the real class" pattern as
 * notifications/test-support/fake-notifications-service.ts.
 * verifyAndParseWebhook parses the raw test body directly, deliberately
 * skipping real signature verification — that's covered by
 * paystack-payout.adapter.spec.ts's own dedicated tests, not by every
 * spec that merely needs a working DistributionsService.
 */
export class FakePaystackPayoutAdapter implements PayoutProviderAdapter {
  readonly provider = "paystack" as const;
  calls: CreatePayoutInput[] = [];
  shouldFail = false;

  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
    this.calls.push(input);
    if (this.shouldFail) throw new Error("Simulated Paystack transfer failure");
    return { providerReference: input.reference };
  }

  async verifyAndParseWebhook(rawBody: Buffer): Promise<PayoutWebhookResult | null> {
    let event: { event: string; data: { reference: string } };
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return null;
    }
    if (event.event === "transfer.success") return { providerReference: event.data.reference, status: "paid" };
    if (event.event === "transfer.failed" || event.event === "transfer.reversed") {
      return { providerReference: event.data.reference, status: "failed" };
    }
    return null;
  }
}

class NoopStubPayoutAdapter implements PayoutProviderAdapter {
  constructor(public readonly provider: "stripe" | "stablecoin") {}
  async createPayout(): Promise<CreatePayoutResult> {
    throw new Error(`${this.provider} payouts aren't supported yet.`);
  }
  async verifyAndParseWebhook(): Promise<PayoutWebhookResult | null> {
    return null;
  }
}

export function createFakeStripePayoutAdapter(): NoopStubPayoutAdapter {
  return new NoopStubPayoutAdapter("stripe");
}

export function createFakeStablecoinPayoutAdapter(): NoopStubPayoutAdapter {
  return new NoopStubPayoutAdapter("stablecoin");
}
