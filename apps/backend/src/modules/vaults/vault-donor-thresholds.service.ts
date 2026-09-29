import { Injectable } from "@nestjs/common";
import { IsNumberString } from "class-validator";
import { prisma } from "@birr/db";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";

export class UpsertVaultDonorThresholdInput {
  @IsNumberString()
  @IsPositiveDecimal()
  thresholdAmount!: string;
}

/**
 * VaultDonorThreshold — the per-currency AML anti-structuring guard
 * checked in VaultContributionsService.findOrCreateDonor (a single
 * contribution at or above this, or a donor's running total crossing
 * it, requires identity capture). Ops-editable without a code change,
 * same "real table, staff-tunable" convention as ContributionMinimum/
 * CorpusMinimum (see WaqfFundingService), but kept staff-only to read —
 * unlike those two, this number is a compliance control, not
 * informational floor guidance a donor should see in advance (see the
 * approved Vault plan's own "short of enterprise KYC on purpose" note).
 */
@Injectable()
export class VaultDonorThresholdsService {
  list() {
    return prisma.vaultDonorThreshold.findMany({ orderBy: { currency: "asc" } });
  }

  async upsert(currency: string, input: UpsertVaultDonorThresholdInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.vaultDonorThreshold.findUnique({ where: { currency } });
      const updated = await tx.vaultDonorThreshold.upsert({
        where: { currency },
        update: { thresholdAmount: input.thresholdAmount },
        create: { currency, thresholdAmount: input.thresholdAmount },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: existing ? "vault_donor_threshold.updated" : "vault_donor_threshold.created",
          entityType: "VaultDonorThreshold",
          entityId: updated.id,
          before: existing as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }
}
