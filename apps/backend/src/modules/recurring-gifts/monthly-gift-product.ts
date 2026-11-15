import type { IdType, Prisma, RecurringGift, RecurringGiftKind, RecurringGiftPauseReason } from "@birr/db";
import type { SavedCardChargeResult } from "../contributions/providers/payment-provider.interface";

/** One payment of a monthly gift, as its product records it. */
export interface MonthlyGiftCharge {
  id: string;
  providerReference: string;
  amount: Prisma.Decimal;
  currency: string;
  status: "pending" | "confirmed" | "failed";
  /** Null for a card-update checkout (see RecurringGiftsCoreService.afterPaymentConfirmed). */
  recurringPeriod: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

/** Whether a gift can be charged this month, decided before any money moves. */
export type MonthlyGiftPrecheck =
  | { ok: true }
  | { pause: RecurringGiftPauseReason }
  /** `reason` is a short phrase for the giver's email ("the Vault has closed"). */
  | { end: string; reason: string };

/** Thrown by a product's charge() when the giver has to act before it can go through. */
export class GiftNeedsGiver extends Error {
  constructor(readonly reason: RecurringGiftPauseReason) {
    super(`Monthly gift needs the giver: ${reason}`);
  }
}

/**
 * How RecurringGiftsService charges one kind of monthly gift. Each product
 * (Vault, waqf top-ups, zakah) charges through its own service's
 * initiate(), so a monthly charge passes every check a one-off gift does.
 */
export interface MonthlyGiftProduct {
  readonly kind: RecurringGiftKind;
  precheck(gift: RecurringGift): Promise<MonthlyGiftPrecheck>;
  /** Charges the saved card for `period`. Throws GiftNeedsGiver when the giver must act first. */
  charge(gift: RecurringGift, period: string): Promise<SavedCardChargeResult>;
  /** This gift's payments, newest first. */
  charges(giftId: string): Promise<MonthlyGiftCharge[]>;
  /** Asks the provider about a payment still pending. */
  reconcile(chargeId: string): Promise<unknown>;
  /** A card-only checkout for the month a paused gift is due, which saves the new card. */
  startCardUpdate(gift: RecurringGift): Promise<{ checkoutUrl: string }>;
  /** The smallest monthly amount allowed now. */
  minimum(): Promise<Prisma.Decimal>;
  /** What the gift goes to, for its manage page. */
  describe(gift: RecurringGift): Promise<{ name: string; detail?: string; link?: string }>;
  /** The giver adds the name and ID the AML threshold asks for (Vault and zakah givers, from their link). */
  recordIdentity?(gift: RecurringGift, identity: GiverIdentity): Promise<void>;
}

export interface GiverIdentity {
  fullName: string;
  idType: IdType;
  idNumber: string;
}
