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
  /** Which frontend route the donor is redirected back to after
   * checkout (Paystack's callback_url / Stripe's success_url+cancel_url)
   * — "contributions" (default) for the Founder Portal's Waqf Fund flow,
   * "vault-contributions" for Vault's public giving flow. These land on
   * two different pages (apps/web/app/(founder)/contributions/[id] vs.
   * .../vault-contributions/[id]) because they poll two different,
   * differently-shaped backend resources (Contribution vs.
   * VaultContribution) and the Vault one has no Founder session to show
   * a "your waqf fund is now active" link for (2026-09-29 codebase
   * walkthrough finding: every Vault Paystack donor was being redirected
   * to the Founder-only page, which itself redirects an unauthenticated
   * visitor straight to /sign-in). */
  returnPath?: "contributions" | "vault-contributions";
}

export interface CreatePaymentResult {
  /** What handleWebhook() matches incoming events against. */
  providerReference: string;
  /** Whatever the frontend needs to actually complete payment — a
   * redirect URL for Stripe/Paystack, an address+amount for the
   * stablecoin gateway. Shape is provider-specific by design. */
  clientPayload: unknown;
}

export type WebhookResult = {
  providerReference: string;
  status: "confirmed" | "failed";
  /** The provider's own charge/payment id, when this webhook event
   * carries one — needed later to call a refund API (see RefundInput's
   * own comment). Omitted where the rail's refund call doesn't need it
   * (Paystack refunds by providerReference directly). */
  providerPaymentId?: string;
};

/**
 * What a provider reports when asked directly about one payment (see
 * PaymentProviderAdapter.verifyPayment) — the pull-side counterpart to
 * WebhookResult. "pending" means the provider doesn't consider it
 * settled either way yet (abandoned/ongoing checkout), so the caller
 * must leave the payment untouched.
 */
export interface VerifiedPayment {
  status: "confirmed" | "failed" | "pending";
  /** What the provider actually charged, in the currency's smallest
   * unit (kobo for NGN) — checked against our own record before anything
   * is confirmed. */
  amountMinorUnits: number;
  currency: string;
  providerPaymentId?: string;
}

export interface RefundInput {
  /** Always present — our own reference, which is what Paystack's
   * refund endpoint accepts directly. */
  providerReference: string;
  /** Stripe-specific: the PaymentIntent id captured from the webhook
   * (see WebhookResult.providerPaymentId) — Stripe's Refund API can't
   * act on a Checkout Session id, only a PaymentIntent or Charge id.
   * Null for rails that don't need it. */
  providerPaymentId: string | null;
  amount: string;
  currency: string;
}

export interface RefundResult {
  /** The provider's own refund confirmation id. */
  refundReference: string;
}

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
  /**
   * Optional — asks the provider directly for one payment's current
   * state, by our own reference. Used when a payer returns from checkout
   * (ContributionsService/VaultContributionsService.reconcile) so a
   * payment isn't stuck "pending" just because its webhook was delayed,
   * lost, or — in local development — could never reach this server at
   * all. Never a substitute for the webhook; both feed the same
   * idempotent confirmation path. Returns null when the provider has no
   * record of the reference. Omitted by rails with no such lookup.
   */
  verifyPayment?: (providerReference: string) => Promise<VerifiedPayment | null>;
  /**
   * Optional — not every rail can reverse a payment automatically.
   * Omitted entirely by StablecoinAdapter (see that adapter's own
   * comment on why a crypto payment has no reversible "refund" API call
   * this platform can invoke). VaultContributionsService.initiateRefund
   * checks for this method's presence before calling it, and still
   * records the refund decision either way.
   */
  refund?(input: RefundInput): Promise<RefundResult>;
}
