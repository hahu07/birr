import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { CreatePayoutInput, CreatePayoutResult, PayoutProviderAdapter, PayoutWebhookResult } from "./payout-provider.interface";

/**
 * Deliberate stub, not a partial implementation — real Stripe payouts to
 * an arbitrary third party (a Beneficiary here, not a Stripe customer)
 * require Stripe Connect: a connected-account onboarding flow with
 * hosted KYC for that beneficiary, run and verified before any payout
 * can be attempted. That's a materially bigger, separate project than
 * this rail — out of scope this round. This adapter exists only so
 * PayoutProvider stays a complete, selectable enum; it must never
 * pretend to succeed. Same honest-stub posture as this session's own
 * Rasid-agent read_regulatory_sources tool.
 */
@Injectable()
export class StripePayoutAdapter implements PayoutProviderAdapter {
  readonly provider = "stripe" as const;

  async createPayout(_input: CreatePayoutInput): Promise<CreatePayoutResult> {
    throw new ServiceUnavailableException(
      "Stripe payouts aren't supported yet — Stripe Connect onboarding is required and hasn't been built. Use Paystack for this beneficiary instead.",
    );
  }

  async verifyAndParseWebhook(): Promise<PayoutWebhookResult | null> {
    return null;
  }
}
