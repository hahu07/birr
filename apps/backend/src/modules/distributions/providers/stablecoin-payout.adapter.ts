import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { CreatePayoutInput, CreatePayoutResult, PayoutProviderAdapter, PayoutWebhookResult } from "./payout-provider.interface";

/**
 * Deliberate stub, not a partial implementation — the connected
 * stablecoin gateway (Coinbase Commerce, see contributions/providers
 * /stablecoin.adapter.ts) is a receive-only merchant product with no
 * send/payout API at all. Actually sending crypto out would mean either
 * Birr custodying a wallet's private keys directly (a real security/
 * custody undertaking) or integrating a different, currently-unwired
 * payout-capable provider — both separate decisions, out of scope this
 * round. This adapter exists only so PayoutProvider stays a complete,
 * selectable enum; it must never pretend to succeed. Same honest-stub
 * posture as this session's own Rasid-agent read_regulatory_sources
 * tool.
 */
@Injectable()
export class StablecoinPayoutAdapter implements PayoutProviderAdapter {
  readonly provider = "stablecoin" as const;

  async createPayout(_input: CreatePayoutInput): Promise<CreatePayoutResult> {
    throw new ServiceUnavailableException(
      "Stablecoin payouts aren't supported yet — the connected gateway has no send/payout API. Use Paystack for this beneficiary instead.",
    );
  }

  async verifyAndParseWebhook(): Promise<PayoutWebhookResult | null> {
    return null;
  }
}
