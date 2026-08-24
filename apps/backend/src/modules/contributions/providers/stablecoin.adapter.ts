import { Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProviderAdapter,
  WebhookResult,
} from "./payment-provider.interface";
import { SettingsService } from "../../../common/settings/settings.service";

interface CommerceChargeResponse {
  data?: { id: string; hosted_url: string };
  error?: { message: string };
}

interface CommerceWebhookEnvelope {
  event: {
    type: string;
    data: { metadata?: { reference?: string } };
  };
}

/**
 * Third-party crypto payment gateway (Coinbase Commerce or an
 * equivalent with the same hosted-charge model), confirmed with the
 * stakeholder over building custom on-chain monitoring. Supports both
 * USDC and USDT — the gateway itself, not this adapter, is what offers
 * a choice of coin/network on its hosted checkout page.
 *
 * Uses the same redirect-to-hosted-checkout pattern as the Stripe and
 * Paystack adapters (not a custom address+QR UI in Birr's own
 * frontend) — the gateway's hosted page already renders the
 * address/QR selection for whichever coin the donor picks, and
 * building a bespoke version of that on unverified assumptions about
 * the gateway's exact response shape would be worse, not better.
 *
 * Field names below follow Coinbase Commerce's publicly documented
 * Charges API as of this writing — verify against their current docs
 * before going live; a details this specific from a third-party API
 * I can't hit with a live account is exactly where documentation drift
 * is most likely.
 */
@Injectable()
export class StablecoinAdapter implements PaymentProviderAdapter {
  readonly provider = "stablecoin" as const;
  private readonly baseUrl = "https://api.commerce.coinbase.com";

  constructor(private readonly settings: SettingsService) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const apiKey = await this.settings.get("stablecoin", "API_KEY");
    if (!apiKey) {
      throw new Error("Stablecoin gateway API key is not configured.");
    }

    const res = await fetch(`${this.baseUrl}/charges`, {
      method: "POST",
      headers: {
        "X-CC-Api-Key": apiKey,
        "X-CC-Version": "2018-03-22",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Waqf Fund contribution",
        pricing_type: "fixed_price",
        local_price: { amount: input.amount, currency: input.currency.toUpperCase() },
        metadata: { reference: input.reference },
      }),
    });
    const body = (await res.json()) as CommerceChargeResponse;
    if (!res.ok || !body.data) {
      throw new Error(`Stablecoin gateway charge creation failed: ${body.error?.message ?? res.statusText}`);
    }

    // providerReference is our own Contribution id (echoed back via
    // metadata.reference in the webhook), not the gateway's charge id —
    // same correlation strategy as the Stripe and Paystack adapters.
    return { providerReference: input.reference, clientPayload: { checkoutUrl: body.data.hosted_url } };
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<WebhookResult | null> {
    const signature = headers["x-cc-webhook-signature"];
    const secret = await this.settings.get("stablecoin", "WEBHOOK_SECRET");
    if (!signature || !secret) return null;

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    const signatureBuf = Buffer.from(signature, "hex");
    if (expectedBuf.length !== signatureBuf.length || !timingSafeEqual(expectedBuf, signatureBuf)) {
      return null;
    }

    let envelope: CommerceWebhookEnvelope;
    try {
      envelope = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return null;
    }

    const reference = envelope.event?.data?.metadata?.reference;
    if (!reference) return null;

    if (envelope.event.type === "charge:confirmed") {
      return { providerReference: reference, status: "confirmed" };
    }
    if (envelope.event.type === "charge:failed") {
      return { providerReference: reference, status: "failed" };
    }
    return null;
  }
}
