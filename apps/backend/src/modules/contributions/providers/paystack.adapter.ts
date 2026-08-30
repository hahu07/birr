import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProviderAdapter,
  WebhookResult,
} from "./payment-provider.interface";
import { SettingsService } from "../../../common/settings/settings.service";
import { verifyPaystackSignature } from "../../../common/payments/verify-paystack-signature";

interface PaystackInitializeResponse {
  status: boolean;
  data?: { authorization_url: string; access_code: string; reference: string };
  message?: string;
}

interface PaystackWebhookEvent {
  event: string;
  data: { reference: string };
}

/**
 * Hand-rolled `fetch` calls against Paystack's REST API — no official
 * maintained Node SDK, and this matches the codebase's existing
 * "hand-authored over dependency" style already used for the icon set.
 * Sandbox/test-mode only per the confirmed plan — PAYSTACK_SECRET_KEY
 * is expected to be a test key (sk_test_...) for now.
 */
@Injectable()
export class PaystackAdapter implements PaymentProviderAdapter {
  readonly provider = "paystack" as const;
  private readonly baseUrl = "https://api.paystack.co";

  constructor(private readonly settings: SettingsService) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const secretKey = await this.settings.get("paystack", "SECRET_KEY");
    if (!secretKey) {
      // A plain Error here surfaces to the founder as an opaque 500
      // "Internal server error" — this is an operator configuration gap
      // (no key set for this environment/rail), not a founder-facing
      // bug, so it gets a clear 503 and an actionable message instead.
      throw new ServiceUnavailableException("Card payments via Nigeria aren't available right now.");
    }
    // Paystack amounts are in the smallest currency unit (kobo for NGN),
    // same 2-decimal-currency assumption as the Stripe adapter's minor-unit math.
    const amountMinorUnits = Math.round(Number(input.amount) * 100);
    const callbackUrl = `${process.env.FOUNDER_PORTAL_URL ?? "http://localhost:3000"}/contributions/${input.reference}`;

    const res = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: input.payerEmail ?? `contributor+${input.reference}@example.com`,
        amount: amountMinorUnits,
        currency: input.currency.toUpperCase(),
        reference: input.reference,
        callback_url: callbackUrl,
      }),
    });
    const body = (await res.json()) as PaystackInitializeResponse;
    if (!res.ok || !body.status || !body.data) {
      throw new Error(`Paystack transaction initialize failed: ${body.message ?? res.statusText}`);
    }

    return {
      providerReference: body.data.reference,
      clientPayload: { checkoutUrl: body.data.authorization_url },
    };
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<WebhookResult | null> {
    const signature = headers["x-paystack-signature"];
    const secretKey = await this.settings.get("paystack", "SECRET_KEY");
    if (!verifyPaystackSignature(rawBody, signature, secretKey)) return null;

    let event: PaystackWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return null;
    }

    if (event.event === "charge.success") {
      return { providerReference: event.data.reference, status: "confirmed" };
    }
    if (event.event === "charge.failed") {
      return { providerReference: event.data.reference, status: "failed" };
    }
    return null;
  }
}
