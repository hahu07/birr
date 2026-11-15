import { Injectable } from "@nestjs/common";
import { prisma, Prisma, type RecurringGift } from "@birr/db";
import { ContributionsService } from "../contributions/contributions.service";
import type { SavedCardChargeResult } from "../contributions/providers/payment-provider.interface";
import type { MonthlyGiftCharge, MonthlyGiftPrecheck, MonthlyGiftProduct } from "./monthly-gift-product";

/** A founder's monthly top-up to their own Waqf Fund, charged through ContributionsService.initiate(). */
@Injectable()
export class WaqfMonthlyProduct implements MonthlyGiftProduct {
  readonly kind = "waqf" as const;

  constructor(private readonly contributions: ContributionsService) {}

  async precheck(gift: RecurringGift): Promise<MonthlyGiftPrecheck> {
    const waqf = await prisma.waqf.findFirst({
      where: { id: gift.waqfId!, foundation: { foundationFounders: { some: { founderId: gift.founderId! } } } },
      select: { status: true },
    });
    if (!waqf) return { end: "founder_left", reason: "you're no longer a founder of this Waqf Fund's Foundation" };
    if (waqf.status !== "active") return { end: "waqf_inactive", reason: "the Waqf Fund isn't active any more" };
    if (new Prisma.Decimal(gift.amount).lt(await this.minimum())) return { pause: "below_minimum" };
    return { ok: true };
  }

  async charge(gift: RecurringGift, period: string) {
    const result = await this.contributions.initiate(
      {
        waqfId: gift.waqfId!,
        founderId: gift.founderId!,
        amount: new Prisma.Decimal(gift.amount).toFixed(2),
        currency: "NGN",
        provider: "paystack",
      },
      { type: "charge", gift, period },
    );
    const { charge } = result as { charge?: SavedCardChargeResult };
    if (!charge) throw new Error(`Monthly top-up "${gift.id}" wasn't charged.`);
    return charge;
  }

  async charges(giftId: string): Promise<MonthlyGiftCharge[]> {
    return this.contributions.chargesForGift(giftId);
  }

  async reconcile(chargeId: string) {
    const row = await prisma.contribution.findUnique({ where: { id: chargeId }, select: { recurringGift: { select: { founderId: true } } } });
    if (!row?.recurringGift?.founderId) return null;
    return this.contributions.reconcileForFounder(chargeId, row.recurringGift.founderId);
  }

  async startCardUpdate(gift: RecurringGift) {
    const result = await this.contributions.initiate(
      {
        waqfId: gift.waqfId!,
        founderId: gift.founderId!,
        amount: new Prisma.Decimal(gift.amount).toFixed(2),
        currency: "NGN",
        provider: "paystack",
      },
      { type: "card_update", gift },
    );
    return { checkoutUrl: (result.clientPayload as { checkoutUrl: string }).checkoutUrl };
  }

  async minimum() {
    const minimum = await prisma.contributionMinimum.findUnique({ where: { currency: "NGN" } });
    return minimum?.minAmount ?? new Prisma.Decimal(0);
  }

  async describe(gift: RecurringGift) {
    const waqf = await prisma.waqf.findUnique({ where: { id: gift.waqfId! }, select: { name: true } });
    return { name: waqf?.name ?? "Your Waqf Fund", link: `/portfolio/${gift.waqfId}` };
  }
}
