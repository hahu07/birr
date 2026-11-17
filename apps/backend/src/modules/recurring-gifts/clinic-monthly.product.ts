import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma, Prisma, type RecurringGift } from "@birr/db";
import { ClinicGiftsService, CLINIC_PUBLIC_MINIMUM_NGN } from "../clinic-waqfs/clinic-gifts.service";
import { VaultContributionsService } from "../vaults/vault-contributions.service";
import { GiftNeedsGiver, type GiverIdentity, type MonthlyGiftCharge, type MonthlyGiftPrecheck, type MonthlyGiftProduct } from "./monthly-gift-product";

const IDENTITY_CODES = new Set(["IDENTITY_REQUIRED", "IDENTITY_CONFIRMATION_REQUIRED", "IDENTITY_MISMATCH"]);

function errorCode(err: unknown): string | undefined {
  if (!(err instanceof BadRequestException)) return undefined;
  const response = err.getResponse();
  return typeof response === "object" && response !== null ? (response as { code?: string }).code : undefined;
}

/**
 * Monthly gifts to a clinic waqf's endowment or running fund (2026-11-17,
 * clinic slice 4b), charged through ClinicGiftsService, so each month
 * passes every check a one-off gift does: a public giver's through the
 * shared AML threshold, a Founder's as the Founder. Owner's decision: a
 * monthly endowment gift pauses (terms_changed) once a newer deed version
 * is approved, until the giver accepts it.
 */
@Injectable()
export class ClinicMonthlyProduct implements MonthlyGiftProduct {
  readonly kind = "clinic" as const;

  constructor(
    private readonly gifts: ClinicGiftsService,
    private readonly vaultContributions: VaultContributionsService,
  ) {}

  async precheck(gift: RecurringGift): Promise<MonthlyGiftPrecheck> {
    const clinic = await prisma.clinicWaqf.findUnique({ where: { id: gift.clinicWaqfId! }, select: { status: true } });
    if (!clinic || clinic.status !== "established") return { end: "clinic_closed", reason: "the clinic isn't taking gifts" };
    if (gift.clinicPot === "endowment") {
      const approved = await prisma.clinicWaqfDeed.findFirst({ where: { clinicWaqfId: gift.clinicWaqfId!, status: "approved" }, select: { id: true } });
      if (approved?.id !== gift.clinicDeedId) return { pause: "terms_changed" };
    }
    if (new Prisma.Decimal(gift.amount).lt(await this.minimum())) return { pause: "below_minimum" };
    return { ok: true };
  }

  private async run(gift: RecurringGift, mode: { type: "charge"; gift: RecurringGift; period: string } | { type: "card_update"; gift: RecurringGift }) {
    const form = { slug: "", pot: gift.clinicPot!, amount: new Prisma.Decimal(gift.amount).toFixed(2), coverFee: gift.coverFee };
    try {
      return gift.founderId
        ? await this.gifts.initiateAsFounder(gift.founderId, null, form, undefined, mode)
        : await this.gifts.initiate(form, undefined, mode);
    } catch (err) {
      const code = errorCode(err);
      if (code && IDENTITY_CODES.has(code)) throw new GiftNeedsGiver("needs_identity");
      if (code === "DEED_CHANGED") throw new GiftNeedsGiver("terms_changed");
      throw err;
    }
  }

  async charge(gift: RecurringGift, period: string) {
    const result = await this.run(gift, { type: "charge", gift, period });
    if (!result.charge) throw new Error(`Monthly clinic gift "${gift.id}" wasn't charged.`);
    return result.charge;
  }

  async charges(giftId: string): Promise<MonthlyGiftCharge[]> {
    return this.gifts.chargesForGift(giftId);
  }

  reconcile(chargeId: string) {
    return this.gifts.reconcile(chargeId);
  }

  async startCardUpdate(gift: RecurringGift) {
    const result = await this.run(gift, { type: "card_update", gift });
    return { checkoutUrl: (result.clientPayload as { checkoutUrl: string }).checkoutUrl };
  }

  /** ₦5,000 a month. A Founder's first gift is ₦250,000, but that's their setup payment, checked when it's made. */
  async minimum() {
    return new Prisma.Decimal(CLINIC_PUBLIC_MINIMUM_NGN);
  }

  async describe(gift: RecurringGift) {
    const clinic = await prisma.clinicWaqf.findUnique({ where: { id: gift.clinicWaqfId! }, select: { name: true, slug: true } });
    return {
      name: clinic?.name ?? "A clinic",
      detail: gift.clinicPot === "endowment" ? "the endowment" : "the running fund",
      link: clinic ? `/clinics/${clinic.slug}` : undefined,
    };
  }

  /** A public giver adds the ID the AML threshold asks for; a Founder never needs to. */
  async recordIdentity(gift: RecurringGift, identity: GiverIdentity) {
    await this.vaultContributions.recordDonorIdentity(gift, identity);
  }
}
