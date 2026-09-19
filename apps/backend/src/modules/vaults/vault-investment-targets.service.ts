import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsNumberString } from "class-validator";
import { prisma, Prisma, InvestmentInstrumentType, InvestmentStatus } from "@birr/db";
import { PORTFOLIO_DRIFT_THRESHOLD_PERCENT } from "../investments/investment-drift.constants";

// See VaultInvestmentsService's own identical constant/comment.
const COMMITTED_INVESTMENT_STATUSES: InvestmentStatus[] = ["pending_shariah_review", "active"];

export class SetVaultInvestmentTargetInput {
  @IsEnum(InvestmentInstrumentType)
  instrumentType!: InvestmentInstrumentType;

  @IsNumberString()
  targetPercent!: Prisma.Decimal | number | string;
}

export interface VaultInstrumentAllocationDrift {
  instrumentType: InvestmentInstrumentType;
  targetPercent: string;
  actualPercent: string;
  actualAmount: string;
  driftPercentagePoints: string;
  drifted: boolean;
}

export interface VaultPortfolioDriftReport {
  vaultId: string;
  totalCommittedAmount: string;
  currency: string | null;
  breakdown: VaultInstrumentAllocationDrift[];
  anyDrifted: boolean;
}

// Vault-side mirror of InvestmentTargetsService — see that service's
// own comment and VaultInvestmentTarget's schema comment for the full
// reasoning.
@Injectable()
export class VaultInvestmentTargetsService {
  async upsertTarget(vaultId: string, input: SetVaultInvestmentTargetInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const vault = await tx.vault.findUnique({ where: { id: vaultId } });
      if (!vault) throw new NotFoundException(`Vault "${vaultId}" not found.`);

      const targetPercent = new Prisma.Decimal(input.targetPercent);
      if (targetPercent.isNegative() || targetPercent.gt(100)) {
        throw new BadRequestException("targetPercent must be between 0 and 100.");
      }

      const others = await tx.vaultInvestmentTarget.findMany({
        where: { vaultId, instrumentType: { not: input.instrumentType } },
      });
      const sum = others.reduce((s, t) => s.plus(t.targetPercent), new Prisma.Decimal(0)).plus(targetPercent);
      if (sum.gt(100)) {
        throw new BadRequestException(
          `Target percentages for "${vault.name}" would total ${sum}% — cannot exceed 100%.`,
        );
      }

      const target = await tx.vaultInvestmentTarget.upsert({
        where: { vaultId_instrumentType: { vaultId, instrumentType: input.instrumentType } },
        update: { targetPercent, setByUserId: actorUserId },
        create: { vaultId, instrumentType: input.instrumentType, targetPercent, setByUserId: actorUserId },
      });

      await tx.auditLog.create({
        data: {
          vaultId,
          actorType: "birr_staff",
          actorUserId,
          action: "vault_investment_target.set",
          entityType: "VaultInvestmentTarget",
          entityId: target.id,
          after: target as any,
        },
      });

      return target;
    });
  }

  list(vaultId: string) {
    return prisma.vaultInvestmentTarget.findMany({ where: { vaultId }, orderBy: { instrumentType: "asc" } });
  }

  async remove(vaultId: string, instrumentType: InvestmentInstrumentType, actorUserId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.vaultInvestmentTarget.findUnique({
        where: { vaultId_instrumentType: { vaultId, instrumentType } },
      });
      if (!existing) throw new NotFoundException(`No target set for "${instrumentType}" on this vault.`);
      await tx.vaultInvestmentTarget.delete({ where: { id: existing.id } });
      await tx.auditLog.create({
        data: {
          vaultId,
          actorType: "birr_staff",
          actorUserId,
          action: "vault_investment_target.removed",
          entityType: "VaultInvestmentTarget",
          entityId: existing.id,
          before: existing as any,
        },
      });
    });
  }

  async computeDrift(vaultId: string): Promise<VaultPortfolioDriftReport> {
    const targets = await prisma.vaultInvestmentTarget.findMany({ where: { vaultId } });
    if (targets.length === 0) {
      return { vaultId, totalCommittedAmount: "0", currency: null, breakdown: [], anyDrifted: false };
    }

    const investments = await prisma.vaultInvestment.findMany({
      where: { vaultId, status: { in: COMMITTED_INVESTMENT_STATUSES } },
      select: { instrumentType: true, allocatedAmount: true, currency: true },
    });

    const totalCommitted = investments.reduce((sum, i) => sum.plus(i.allocatedAmount), new Prisma.Decimal(0));
    // VaultInvestment.currency is always the owning vault's primary
    // currency (vault-investments.service.ts's createOne hardcodes it —
    // vault investments are never made in one of additionalCurrencies).
    const currency =
      investments[0]?.currency ??
      (await prisma.vault.findUnique({ where: { id: vaultId }, select: { currency: true } }))?.currency ??
      null;

    const byType = new Map<InvestmentInstrumentType, Prisma.Decimal>();
    for (const i of investments) {
      byType.set(i.instrumentType, (byType.get(i.instrumentType) ?? new Prisma.Decimal(0)).plus(i.allocatedAmount));
    }

    const breakdown: VaultInstrumentAllocationDrift[] = targets.map((target) => {
      const actualAmount = byType.get(target.instrumentType) ?? new Prisma.Decimal(0);
      const actualPercent = totalCommitted.isZero() ? new Prisma.Decimal(0) : actualAmount.div(totalCommitted).times(100);
      const driftPercentagePoints = actualPercent.minus(target.targetPercent);
      const drifted = driftPercentagePoints.abs().gt(PORTFOLIO_DRIFT_THRESHOLD_PERCENT);
      return {
        instrumentType: target.instrumentType,
        targetPercent: target.targetPercent.toString(),
        actualPercent: actualPercent.toString(),
        actualAmount: actualAmount.toString(),
        driftPercentagePoints: driftPercentagePoints.toString(),
        drifted,
      };
    });

    return {
      vaultId,
      totalCommittedAmount: totalCommitted.toString(),
      currency,
      breakdown,
      anyDrifted: breakdown.some((b) => b.drifted),
    };
  }
}
