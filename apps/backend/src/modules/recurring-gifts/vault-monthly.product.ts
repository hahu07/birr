import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma, Prisma, type RecurringGift } from "@birr/db";
import { VaultContributionsService } from "../vaults/vault-contributions.service";
import { GiftNeedsGiver, type GiverIdentity, type MonthlyGiftCharge, type MonthlyGiftPrecheck, type MonthlyGiftProduct } from "./monthly-gift-product";

const IDENTITY_CODES = new Set(["IDENTITY_REQUIRED", "IDENTITY_CONFIRMATION_REQUIRED", "IDENTITY_MISMATCH"]);

function errorCode(err: unknown): string | undefined {
  if (!(err instanceof BadRequestException)) return undefined;
  const response = err.getResponse();
  return typeof response === "object" && response !== null ? (response as { code?: string }).code : undefined;
}

/** Monthly Vault gifts, charged through VaultContributionsService.initiate(). */
@Injectable()
export class VaultMonthlyProduct implements MonthlyGiftProduct {
  readonly kind = "vault" as const;

  constructor(private readonly contributions: VaultContributionsService) {}

  async precheck(gift: RecurringGift): Promise<MonthlyGiftPrecheck> {
    const vault = await prisma.vault.findUnique({ where: { id: gift.vaultId! }, select: { status: true, deletedAt: true } });
    if (!vault || vault.deletedAt || vault.status !== "open") return { end: "vault_closed", reason: "the Vault has closed" };
    if (gift.vaultCauseId) {
      const cause = await prisma.vaultCause.findUnique({ where: { id: gift.vaultCauseId }, select: { deletedAt: true } });
      if (!cause || cause.deletedAt) return { end: "cause_removed", reason: "the cause you chose is no longer part of the Vault" };
    }
    if (new Prisma.Decimal(gift.amount).lt(await this.minimum())) return { pause: "below_minimum" };
    return { ok: true };
  }

  async charge(gift: RecurringGift, period: string) {
    try {
      const result = await this.contributions.initiate(
        {
          vaultId: gift.vaultId!,
          vaultCauseId: gift.vaultCauseId ?? undefined,
          amount: new Prisma.Decimal(gift.amount).toFixed(2),
          currency: "NGN",
          provider: "paystack",
          donorEmail: gift.email ?? undefined,
        },
        undefined,
        { type: "charge", gift, period },
      );
      return result.charge!;
    } catch (err) {
      if (IDENTITY_CODES.has(errorCode(err) ?? "")) throw new GiftNeedsGiver("needs_identity");
      throw err;
    }
  }

  async charges(giftId: string): Promise<MonthlyGiftCharge[]> {
    return this.contributions.chargesForGift(giftId);
  }

  reconcile(chargeId: string) {
    return this.contributions.reconcile(chargeId);
  }

  async startCardUpdate(gift: RecurringGift) {
    const result = await this.contributions.initiate(
      {
        vaultId: gift.vaultId!,
        vaultCauseId: gift.vaultCauseId ?? undefined,
        amount: new Prisma.Decimal(gift.amount).toFixed(2),
        currency: "NGN",
        provider: "paystack",
        donorEmail: gift.email ?? undefined,
      },
      undefined,
      { type: "card_update", gift },
    );
    return { checkoutUrl: (result.clientPayload as { checkoutUrl: string }).checkoutUrl };
  }

  async minimum() {
    // Vault's own floor, not the Waqf top-up one (2026-11-16).
    const minimum = await prisma.vaultGiftMinimum.findUnique({ where: { currency: "NGN" } });
    return minimum?.minAmount ?? new Prisma.Decimal(0);
  }

  async describe(gift: RecurringGift) {
    const vault = await prisma.vault.findUnique({ where: { id: gift.vaultId! }, select: { name: true, slug: true } });
    const cause = gift.vaultCauseId
      ? await prisma.vaultCause.findUnique({ where: { id: gift.vaultCauseId }, select: { name: true } })
      : null;
    return { name: vault?.name ?? "A Vault", detail: cause?.name, link: vault ? `/vaults/${vault.slug}` : undefined };
  }

  async recordIdentity(gift: RecurringGift, identity: GiverIdentity) {
    await this.contributions.recordDonorIdentity(gift, identity);
  }
}
