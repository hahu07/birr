import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, type RecurringGift } from "@birr/db";
import { ZakahPaymentsService } from "../zakah/zakah-payments.service";
import { ZAKAH_MINIMUM_PAYMENT_NGN, ZAKAH_WAKALAH_TERMS } from "../zakah/zakah-terms";
import type { SavedCardChargeResult } from "../contributions/providers/payment-provider.interface";
import { GiftNeedsGiver, type GiverIdentity, type MonthlyGiftCharge, type MonthlyGiftPrecheck, type MonthlyGiftProduct } from "./monthly-gift-product";

const IDENTITY_CODES = new Set(["IDENTITY_REQUIRED", "IDENTITY_CONFIRMATION_REQUIRED", "IDENTITY_MISMATCH"]);

function errorCode(err: unknown): string | undefined {
  if (!(err instanceof BadRequestException)) return undefined;
  const response = err.getResponse();
  return typeof response === "object" && response !== null ? (response as { code?: string }).code : undefined;
}

/**
 * Monthly zakah on wealth, paid in advance (ta'jil), charged through
 * ZakahPaymentsService.initiate(): into the zakah subaccount, under the
 * wakalah terms the payer accepted, recording the ruleset and prices of
 * the calculation they set it up from.
 */
@Injectable()
export class ZakahMonthlyProduct implements MonthlyGiftProduct {
  readonly kind = "zakah" as const;

  constructor(private readonly payments: ZakahPaymentsService) {}

  async precheck(gift: RecurringGift): Promise<MonthlyGiftPrecheck> {
    // The payer accepted a wording that has since changed: they must accept the new one first.
    if (gift.wakalahConsentVersion !== ZAKAH_WAKALAH_TERMS.version) return { pause: "terms_changed" };
    if (new Prisma.Decimal(gift.amount).lt(ZAKAH_MINIMUM_PAYMENT_NGN)) return { pause: "below_minimum" };
    return { ok: true };
  }

  private input(gift: RecurringGift) {
    return {
      kind: "mal" as const,
      amount: new Prisma.Decimal(gift.amount).toFixed(2),
      coverFee: gift.coverFee,
      wakalahConsentVersion: gift.wakalahConsentVersion!,
      payerEmail: gift.email,
      rulesetKey: gift.zakahRulesetKey ?? undefined,
      rulesetVersion: gift.zakahRulesetVersion ?? undefined,
    };
  }

  async charge(gift: RecurringGift, period: string) {
    try {
      const result = await this.payments.initiate(this.input(gift), undefined, { type: "charge", gift, period });
      const { charge } = result as { charge?: SavedCardChargeResult };
      if (!charge) throw new Error(`Monthly zakah "${gift.id}" wasn't charged.`);
      return charge;
    } catch (err) {
      const code = errorCode(err);
      if (code && IDENTITY_CODES.has(code)) throw new GiftNeedsGiver("needs_identity");
      if (code === "WAKALAH_TERMS_CHANGED") throw new GiftNeedsGiver("terms_changed");
      throw err;
    }
  }

  async charges(giftId: string): Promise<MonthlyGiftCharge[]> {
    return this.payments.chargesForGift(giftId);
  }

  reconcile(chargeId: string) {
    return this.payments.reconcile(chargeId);
  }

  async startCardUpdate(gift: RecurringGift) {
    const result = await this.payments.initiate(this.input(gift), undefined, { type: "card_update", gift });
    return { checkoutUrl: (result.clientPayload as { checkoutUrl: string }).checkoutUrl };
  }

  async minimum() {
    return new Prisma.Decimal(ZAKAH_MINIMUM_PAYMENT_NGN);
  }

  async describe() {
    return { name: "Zakah on wealth", detail: "paid in advance" };
  }

  async recordIdentity(gift: RecurringGift, identity: GiverIdentity) {
    await this.payments.recordPayerIdentity(gift.email, identity);
  }
}
