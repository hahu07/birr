import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProviderAdapter,
  RefundInput,
  RefundResult,
  SavedCardAuthorization,
  SavedCardChargeInput,
  SavedCardChargeResult,
  VerifiedPayment,
  WebhookResult,
} from "./payment-provider.interface";
import { SettingsService } from "../../../common/settings/settings.service";
import { verifyPaystackSignature } from "../../../common/payments/verify-paystack-signature";

interface PaystackInitializeResponse {
  status: boolean;
  data?: { authorization_url: string; access_code: string; reference: string };
  message?: string;
}

interface PaystackRefundResponse {
  status: boolean;
  data?: { id: number; transaction: { reference: string } };
  message?: string;
}

interface PaystackAuthorization {
  authorization_code?: string;
  reusable?: boolean;
  channel?: string;
  last4?: string;
  brand?: string;
  card_type?: string;
  exp_month?: string;
  exp_year?: string;
}

interface PaystackVerifyResponse {
  status: boolean;
  data?: {
    id: number;
    status: string;
    reference: string;
    amount: number;
    currency: string;
    authorization?: PaystackAuthorization;
  };
  message?: string;
}

interface PaystackChargeAuthorizationResponse {
  status: boolean;
  data?: { id: number; status: string; reference: string; gateway_response?: string };
  message?: string;
}

function toSavedCard(auth: PaystackAuthorization | undefined): SavedCardAuthorization | undefined {
  if (!auth?.authorization_code) return undefined;
  const month = Number(auth.exp_month);
  const year = Number(auth.exp_year);
  return {
    authorizationCode: auth.authorization_code,
    reusable: auth.reusable === true,
    channel: auth.channel ?? "unknown",
    last4: auth.last4 ?? null,
    brand: (auth.brand ?? auth.card_type)?.trim() || null,
    expMonth: Number.isInteger(month) && month >= 1 && month <= 12 ? month : null,
    expYear: Number.isInteger(year) && year > 2000 ? year : null,
  };
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
    const callbackUrl = `${process.env.FOUNDER_PORTAL_URL ?? "http://localhost:3000"}/${input.returnPath ?? "contributions"}/${input.reference}`;

    const res = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: input.payerEmail ?? `contributor+${input.reference}@example.com`,
        amount: amountMinorUnits,
        currency: input.currency.toUpperCase(),
        reference: input.reference,
        callback_url: callbackUrl,
        ...(input.cardOnly && { channels: ["card"] }),
        ...(input.split && {
          subaccount: input.split.subaccount,
          // A flat amount (kobo) kept by the main account; it overrides the
          // subaccount's configured percentage split.
          transaction_charge: input.split.mainAccountShareMinorUnits,
          bearer: "account",
        }),
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

  // GET /transaction/verify/:reference — Paystack's own recommended way
  // to confirm a transaction server-side, alongside webhooks. Only
  // "success" confirms; "failed"/"reversed" fail; anything else
  // (abandoned, ongoing, pending, queued) is not settled yet.
  async verifyPayment(providerReference: string): Promise<VerifiedPayment | null> {
    const secretKey = await this.settings.get("paystack", "SECRET_KEY");
    if (!secretKey) {
      throw new ServiceUnavailableException("Card payments via Nigeria aren't available right now.");
    }
    const res = await fetch(`${this.baseUrl}/transaction/verify/${encodeURIComponent(providerReference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (res.status === 404) return null;
    const body = (await res.json()) as PaystackVerifyResponse;
    if (!res.ok || !body.status || !body.data) {
      throw new Error(`Paystack transaction verify failed: ${body.message ?? res.statusText}`);
    }
    const status = body.data.status === "success" ? "confirmed" : body.data.status === "failed" || body.data.status === "reversed" ? "failed" : "pending";
    return {
      status,
      amountMinorUnits: body.data.amount,
      currency: body.data.currency.toUpperCase(),
      providerPaymentId: String(body.data.id),
      authorization: toSavedCard(body.data.authorization),
    };
  }

  /**
   * Charges a saved card (POST /transaction/charge_authorization), for a
   * monthly gift's later months. Paystack usually answers with the
   * outcome straight away; a "pending" answer is settled by the
   * charge.success / charge.failed webhook, which matches our reference
   * like any other payment.
   */
  async chargeSavedCard(input: SavedCardChargeInput): Promise<SavedCardChargeResult> {
    const secretKey = await this.settings.get("paystack", "SECRET_KEY");
    if (!secretKey) {
      throw new ServiceUnavailableException("Card payments via Nigeria aren't available right now.");
    }
    const res = await fetch(`${this.baseUrl}/transaction/charge_authorization`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: input.email,
        amount: Math.round(Number(input.amount) * 100),
        currency: input.currency.toUpperCase(),
        authorization_code: input.authorizationCode,
        reference: input.reference,
        ...(input.split && {
          subaccount: input.split.subaccount,
          transaction_charge: input.split.mainAccountShareMinorUnits,
          bearer: "account",
        }),
      }),
    });
    const body = (await res.json()) as PaystackChargeAuthorizationResponse;
    // A refused request (bad authorisation, card no longer chargeable) is
    // a declined charge for the giver, not an outage.
    if (!body.data) {
      if (res.status >= 500) throw new Error(`Paystack charge_authorization failed: ${body.message ?? res.statusText}`);
      return { status: "failed", gatewayResponse: body.message ?? res.statusText };
    }
    const status = body.data.status === "success" ? "confirmed" : body.data.status === "failed" ? "failed" : "pending";
    return { status, providerPaymentId: String(body.data.id), gatewayResponse: body.data.gateway_response };
  }

  // Unlike Stripe, Paystack's refund endpoint accepts the original
  // transaction reference directly — no separate payment-intent-style
  // id needed (input.providerPaymentId is always null for this rail).
  async refund(input: RefundInput): Promise<RefundResult> {
    const secretKey = await this.settings.get("paystack", "SECRET_KEY");
    if (!secretKey) {
      throw new ServiceUnavailableException("Refunds via Paystack aren't available right now.");
    }
    const res = await fetch(`${this.baseUrl}/refund`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ transaction: input.providerReference }),
    });
    const body = (await res.json()) as PaystackRefundResponse;
    if (!res.ok || !body.status) {
      throw new Error(`Paystack refund failed: ${body.message ?? res.statusText}`);
    }
    return { refundReference: body.data?.id != null ? String(body.data.id) : input.providerReference };
  }
}
