import { PayoutProvider } from "@birr/db";

/** Decrypted shape of Beneficiary.bankDetailsEncrypted, plus the
 * payout-only bankCode field — see BeneficiariesService.BankDetailsInput
 * and getDecryptedBankDetailsForPayout's own comment on why bankCode
 * stays optional at the DTO level but required by the time this shape
 * reaches an adapter. */
export interface PayoutBankDetails {
  bankName: string;
  accountNumber: string;
  accountName: string;
  bankCode?: string;
}

export interface CreatePayoutInput {
  /** Decimal string, e.g. "500.00" — avoids float rounding on money. */
  amount: string;
  currency: string;
  /** The Distribution row's own id — passed through to the provider so
   * the webhook can be matched back without a second lookup table, same
   * convention as CreatePaymentInput.reference on the inbound side. */
  reference: string;
  bankDetails: PayoutBankDetails;
}

export interface CreatePayoutResult {
  /** What verifyAndParseWebhook() matches incoming events against. */
  providerReference: string;
}

export type PayoutWebhookResult = { providerReference: string; status: "paid" | "failed" };

export interface PayoutProviderAdapter {
  readonly provider: PayoutProvider;
  createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult>;
  /**
   * Same contract as PaymentProviderAdapter.verifyAndParseWebhook, but
   * for the outbound (transfer) event family. Must return null both on
   * a bad signature AND on "not an event this adapter's payout family
   * recognizes" — the caller (DistributionsService.handlePayoutWebhook,
   * and above it ContributionsController's webhook dispatch) cannot
   * distinguish those two null cases and must not need to, since both
   * mean "not handled here, let the inbound-charge parser have its own
   * chance at the same raw body."
   */
  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<PayoutWebhookResult | null>;
}
