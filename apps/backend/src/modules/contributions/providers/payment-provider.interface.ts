import { ContributionProvider } from "@birr/db";

export interface CreatePaymentInput {
  /** Decimal string, e.g. "500.00" — avoids float rounding on money. */
  amount: string;
  currency: string;
  /** The Contribution row's own id — passed through to the provider so
   * the webhook can be matched back without a second lookup table. */
  reference: string;
  /** Paystack requires an email on transaction initialize; Stripe/the
   * stablecoin gateway don't need it. Optional here rather than a
   * Paystack-only field — there's no captured founder email yet (no
   * FounderMembership/real auth built), so callers that don't have one
   * fall back to a synthetic placeholder; revisit once real identity
   * exists. */
  payerEmail?: string;
}

export interface CreatePaymentResult {
  /** What handleWebhook() matches incoming events against. */
  providerReference: string;
  /** Whatever the frontend needs to actually complete payment — a
   * redirect URL for Stripe/Paystack, an address+amount for the
   * stablecoin gateway. Shape is provider-specific by design. */
  clientPayload: unknown;
}

export type WebhookResult = { providerReference: string; status: "confirmed" | "failed" };

export interface PaymentProviderAdapter {
  readonly provider: ContributionProvider;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /**
   * Verifies the webhook signature against the *raw* request body
   * (see main.ts's raw-body carve-out for these routes) and parses the
   * event. Returns null if signature verification fails — the caller
   * must reject the request outright (401) in that case, never process
   * the payload. This is the entire security boundary for webhook
   * routes, which are never founder-session-authenticated.
   */
  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<WebhookResult | null>;
}
