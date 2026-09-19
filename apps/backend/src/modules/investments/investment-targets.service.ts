import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsNumberString } from "class-validator";
import { prisma, Prisma, InvestmentInstrumentType, InvestmentStatus } from "@birr/db";
import { PORTFOLIO_DRIFT_THRESHOLD_PERCENT } from "./investment-drift.constants";

// "Real" — money genuinely still committed. Same set as
// InvestmentsService's own constant of the same name — duplicated
// here rather than imported, matching this codebase's existing
// tolerance for this one duplication (see InvestmentsService's own
// comment on it).
const COMMITTED_INVESTMENT_STATUSES: InvestmentStatus[] = ["pending_shariah_review", "active"];

export class SetInvestmentTargetInput {
  @IsEnum(InvestmentInstrumentType)
  instrumentType!: InvestmentInstrumentType;

  @IsNumberString()
  targetPercent!: Prisma.Decimal | number | string;
}

export interface InstrumentAllocationDrift {
  instrumentType: InvestmentInstrumentType;
  targetPercent: string;
  actualPercent: string;
  actualAmount: string;
  driftPercentagePoints: string;
  drifted: boolean;
}

export interface PortfolioDriftReport {
  waqfId: string;
  totalCommittedAmount: string;
  currency: string | null;
  breakdown: InstrumentAllocationDrift[];
  anyDrifted: boolean;
}

// Staff-set target allocation by instrument type, and the drift
// computation against it — see InvestmentTarget's own schema comment
// for the full reasoning (unset instrumentType means "no opinion," not
// "target 0%"; only investment_committee may set/change these).
@Injectable()
export class InvestmentTargetsService {
  async upsertTarget(waqfId: string, input: SetInvestmentTargetInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const waqf = await tx.waqf.findUnique({ where: { id: waqfId } });
      if (!waqf) throw new NotFoundException(`Waqf "${waqfId}" not found.`);

      const targetPercent = new Prisma.Decimal(input.targetPercent);
      if (targetPercent.isNegative() || targetPercent.gt(100)) {
        throw new BadRequestException("targetPercent must be between 0 and 100.");
      }

      // Every OTHER instrument type's target, plus this one's new value —
      // an update to an already-targeted type replaces its own
      // contribution to the sum rather than double-counting it.
      const others = await tx.investmentTarget.findMany({
        where: { waqfId, instrumentType: { not: input.instrumentType } },
      });
      const sum = others.reduce((s, t) => s.plus(t.targetPercent), new Prisma.Decimal(0)).plus(targetPercent);
      if (sum.gt(100)) {
        throw new BadRequestException(
          `Target percentages for "${waqf.name}" would total ${sum}% — cannot exceed 100%.`,
        );
      }

      const target = await tx.investmentTarget.upsert({
        where: { waqfId_instrumentType: { waqfId, instrumentType: input.instrumentType } },
        update: { targetPercent, setByUserId: actorUserId },
        create: { waqfId, instrumentType: input.instrumentType, targetPercent, setByUserId: actorUserId },
      });

      await tx.auditLog.create({
        data: {
          waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "investment_target.set",
          entityType: "InvestmentTarget",
          entityId: target.id,
          after: target as any,
        },
      });

      return target;
    });
  }

  list(waqfId: string) {
    return prisma.investmentTarget.findMany({ where: { waqfId }, orderBy: { instrumentType: "asc" } });
  }

  async remove(waqfId: string, instrumentType: InvestmentInstrumentType, actorUserId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.investmentTarget.findUnique({
        where: { waqfId_instrumentType: { waqfId, instrumentType } },
      });
      if (!existing) throw new NotFoundException(`No target set for "${instrumentType}" on this waqf.`);
      await tx.investmentTarget.delete({ where: { id: existing.id } });
      await tx.auditLog.create({
        data: {
          waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "investment_target.removed",
          entityType: "InvestmentTarget",
          entityId: existing.id,
          before: existing as any,
        },
      });
    });
  }

  /**
   * Single source of truth for "how far is this waqf's actual
   * instrument-type mix from its stated target" — called both by
   * PortfolioDriftScheduler (to decide whether to notify) and the
   * on-demand GET route (so staff can see the full breakdown, not just
   * "something drifted").
   */
  async computeDrift(waqfId: string): Promise<PortfolioDriftReport> {
    const targets = await prisma.investmentTarget.findMany({ where: { waqfId } });
    if (targets.length === 0) {
      // No opinion set for this fund at all — nothing to drift from.
      return { waqfId, totalCommittedAmount: "0", currency: null, breakdown: [], anyDrifted: false };
    }

    const investments = await prisma.investment.findMany({
      where: { waqfId, status: { in: COMMITTED_INVESTMENT_STATUSES } },
      select: { instrumentType: true, allocatedAmount: true, currency: true },
    });

    const totalCommitted = investments.reduce((sum, i) => sum.plus(i.allocatedAmount), new Prisma.Decimal(0));
    // Investment.currency is always the owning waqf's own corpusCurrency
    // (see that field's own schema comment) — every row here shares one
    // currency, unlike CounterpartyExposure which spans multiple waqfs.
    const currency =
      investments[0]?.currency ??
      (await prisma.waqf.findUnique({ where: { id: waqfId }, select: { corpusCurrency: true } }))?.corpusCurrency ??
      null;

    const byType = new Map<InvestmentInstrumentType, Prisma.Decimal>();
    for (const i of investments) {
      byType.set(i.instrumentType, (byType.get(i.instrumentType) ?? new Prisma.Decimal(0)).plus(i.allocatedAmount));
    }

    // Instrument types with real committed money but no target row are
    // intentionally excluded below — consistent with "unset ≠ 0%" (see
    // InvestmentTarget's own schema comment). A known, accepted
    // limitation: real allocation can exist in a type nobody is
    // tracking, same tradeoff Counterparty.concentrationLimit already
    // makes by being opt-in rather than defaulting to zero.
    const breakdown: InstrumentAllocationDrift[] = targets.map((target) => {
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
      waqfId,
      totalCommittedAmount: totalCommitted.toString(),
      currency,
      breakdown,
      anyDrifted: breakdown.some((b) => b.drifted),
    };
  }
}
