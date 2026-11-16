import { EncryptionService } from "../../../common/settings/encryption.service";
import type {
  SavedCardAuthorization,
  SavedCardChargeInput,
  SavedCardChargeResult,
  VerifiedPayment,
} from "../../contributions/providers/payment-provider.interface";
import type { PaystackAdapter } from "../../contributions/providers/paystack.adapter";
import type { RecurringGiftEmail, ResendRecurringGiftEmailAdapter } from "../email/resend-recurring-gift-email.adapter";
import { RecurringGiftsCoreService } from "../recurring-gifts-core.service";
import type { FakeWhatsApp } from "../../../common/whatsapp/test-support/fake-whatsapp";
import type { TwilioWhatsAppAdapter } from "../../../common/whatsapp/twilio-whatsapp.adapter";

/** A reusable test card, as Paystack reports one after a card payment. */
export const REUSABLE_CARD: SavedCardAuthorization = {
  authorizationCode: "AUTH_test_reusable",
  reusable: true,
  channel: "card",
  last4: "4081",
  brand: "visa",
  expMonth: 12,
  expYear: 2030,
};

/**
 * Stands in for PaystackAdapter's monthly-giving calls. Never reaches
 * Paystack: `card` is what verifyPayment reports for any reference, and
 * `nextCharge` is the outcome of the next saved-card charge.
 */
export class FakeRecurringPaystack {
  readonly provider = "paystack" as const;
  card: SavedCardAuthorization | undefined = REUSABLE_CARD;
  nextCharge: SavedCardChargeResult = { status: "confirmed", providerPaymentId: "pay_fake" };
  charges: SavedCardChargeInput[] = [];
  checkouts: { reference: string; cardOnly?: boolean }[] = [];
  /** What verifyPayment reports per reference; "confirmed" unless set. */
  statuses = new Map<string, "confirmed" | "failed" | "pending">();
  private amounts = new Map<string, string>();

  async createPayment(input: { reference: string; amount: string; cardOnly?: boolean }) {
    this.checkouts.push({ reference: input.reference, cardOnly: input.cardOnly });
    this.amounts.set(input.reference, input.amount);
    return { providerReference: input.reference, clientPayload: { checkoutUrl: `https://checkout.test/${input.reference}` } };
  }

  async verifyPayment(reference: string): Promise<VerifiedPayment | null> {
    return {
      status: this.statuses.get(reference) ?? "confirmed",
      amountMinorUnits: Math.round(Number(this.amounts.get(reference) ?? "0") * 100),
      currency: "NGN",
      providerPaymentId: `pay_${reference}`,
      authorization: this.card,
    };
  }

  async chargeSavedCard(input: SavedCardChargeInput): Promise<SavedCardChargeResult> {
    this.charges.push(input);
    this.amounts.set(input.reference, input.amount);
    return this.nextCharge;
  }

  async verifyAndParseWebhook() {
    return null;
  }
}

export class FakeRecurringGiftEmails {
  sent: RecurringGiftEmail[] = [];
  async send(email: RecurringGiftEmail): Promise<void> {
    this.sent.push(email);
  }
}

/** A real RecurringGiftsCoreService around the fakes above. */
export function createFakeRecurringGiftsCore(paystack = new FakeRecurringPaystack(), emails = new FakeRecurringGiftEmails(), whatsApp?: FakeWhatsApp) {
  const core = new RecurringGiftsCoreService(
    paystack as unknown as PaystackAdapter,
    new EncryptionService(),
    emails as unknown as ResendRecurringGiftEmailAdapter,
    whatsApp as unknown as TwilioWhatsAppAdapter | undefined,
  );
  return { core, paystack, emails, whatsApp };
}
