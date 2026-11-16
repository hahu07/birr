import { Injectable } from "@nestjs/common";
import { IsNumberString } from "class-validator";
import { prisma } from "@birr/db";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";

export class UpsertVaultGiftMinimumInput {
  @IsNumberString()
  @IsPositiveDecimal()
  minAmount!: string;
}

/**
 * VaultGiftMinimum — the smallest public Vault gift per currency, one-off
 * or monthly (owner's decision, 2026-11-16). Until then Vault gifts were
 * floored by ContributionMinimum, the Waqf top-up floor, so raising that
 * for founders silently raised it for every public donor too. Same "real
 * table, staff-tunable" convention as VaultDonorThreshold, but public to
 * read: the giving page shows it before a donor types an amount.
 */
@Injectable()
export class VaultGiftMinimumsService {
  list() {
    return prisma.vaultGiftMinimum.findMany({ orderBy: { currency: "asc" } });
  }

  async upsert(currency: string, input: UpsertVaultGiftMinimumInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.vaultGiftMinimum.findUnique({ where: { currency } });
      const updated = await tx.vaultGiftMinimum.upsert({
        where: { currency },
        update: { minAmount: input.minAmount },
        create: { currency, minAmount: input.minAmount },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: existing ? "vault_gift_minimum.updated" : "vault_gift_minimum.created",
          entityType: "VaultGiftMinimum",
          entityId: updated.id,
          before: existing as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }
}
