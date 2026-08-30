import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import Stripe from "stripe";
import {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProviderAdapter,
  WebhookResult,
} from "./payment-provider.interface";
import { SettingsService } from "../../../common/settings/settings.service";

/**
 * Checkout Sessions (redirect-based), not embedded Elements — simplest
 * correct integration for a first pass; no card data ever touches
 * Birr's own frontend or backend. Sandbox/test-mode only per the
 * confirmed plan — the Stripe secret key is expected to be a test key
 * (sk_test_...) until Birr is ready to go live, which is a business
 * decision, not something this adapter enforces.
 */
@Injectable()
export class StripeAdapter implements PaymentProviderAdapter {
  readonly provider = "stripe" as const;
  private stripeClient: Stripe | undefined;
  private cachedApiKey: string | undefined;

  constructor(private readonly settings: SettingsService) {}

  // Constructed lazily, not in the constructor — the `stripe` SDK
  // throws immediately if given an empty API key (confirmed the hard
  // way: this crashed the whole backend at boot when the key was unset,
  // since Nest instantiates every provider eagerly at startup regardless
  // of whether it's ever called). Building the client only when a
  // payment/webhook actually needs it means the backend still boots
  // fine with Stripe unconfigured; only an actual attempt to use it
  // fails, with a clear message. Re-checks SettingsService.get() every
  // call (cheap DB lookup) and rebuilds the client if the key changed
  // since the last call — a key set via the Platform Settings dashboard
  // must take effect without a restart.
  private async getStripe(): Promise<Stripe> {
    const apiKey = await this.settings.get("stripe", "SECRET_KEY");
    if (!apiKey) {
      // A plain Error here surfaces to the founder as an opaque 500
      // "Internal server error" — this is an operator configuration gap
      // (no key set for this environment/rail), not a founder-facing
      // bug, so it gets a clear 503 and an actionable message instead.
      throw new ServiceUnavailableException("Card payments aren't available right now.");
    }
    if (!this.stripeClient || apiKey !== this.cachedApiKey) {
      // Pinned to the version the installed `stripe` package's types
      // expect (v22.x) — bump together when upgrading the SDK.
      this.stripeClient = new Stripe(apiKey, { apiVersion: "2026-07-29.dahlia" });
      this.cachedApiKey = apiKey;
    }
    return this.stripeClient;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const stripe = await this.getStripe();
    const amountMinorUnits = Math.round(Number(input.amount) * 100);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: amountMinorUnits,
            product_data: { name: "Waqf Fund contribution" },
          },
          quantity: 1,
        },
      ],
      client_reference_id: input.reference,
      success_url: `${process.env.FOUNDER_PORTAL_URL ?? "http://localhost:3000"}/contributions/${input.reference}`,
      cancel_url: `${process.env.FOUNDER_PORTAL_URL ?? "http://localhost:3000"}/contributions/${input.reference}`,
    });

    // providerReference is the Contribution's own id, not Stripe's
    // session id — same correlation strategy as the Paystack and
    // stablecoin adapters (each provider is told our reference and
    // echoes it back in the webhook payload), so handleWebhook() can
    // match on the same field regardless of which provider fired.
    return { providerReference: input.reference, clientPayload: { checkoutUrl: session.url } };
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<WebhookResult | null> {
    const signature = headers["stripe-signature"];
    const secret = await this.settings.get("stripe", "WEBHOOK_SECRET");
    if (!signature || !secret) return null;

    const stripe = await this.getStripe();
    let event: Stripe.Event;
    try {
      // constructEvent is what makes the raw-body carve-out in main.ts
      // load-bearing — it recomputes the HMAC over these exact bytes and
      // compares to the signature header; a re-serialized body fails
      // this check even for a genuinely legitimate event.
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      return null;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!session.client_reference_id) return null;
      return { providerReference: session.client_reference_id, status: "confirmed" };
    }
    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!session.client_reference_id) return null;
      return { providerReference: session.client_reference_id, status: "failed" };
    }
    return null;
  }
}
