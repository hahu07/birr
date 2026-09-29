import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, MinLength } from "class-validator";
import { prisma, Prisma, InvestmentInstrumentType, InvestmentStatus, ShariahScreeningDecision } from "@birr/db";
import { findVaultOrThrow } from "./find-vault-or-throw";
import { SPENDABLE_CONTRIBUTION_WHERE } from "./spendable-contributions";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";

// See InvestmentsService's own identical constant/comment.
const COMMITTED_INVESTMENT_STATUSES: InvestmentStatus[] = ["pending_shariah_review", "active"];

export class CreateVaultInvestmentInput {
  @IsString()
  vaultId!: string;

  @IsString()
  name!: string;

  @IsEnum(InvestmentInstrumentType)
  instrumentType!: InvestmentInstrumentType;

  @IsNumberString()
  @IsPositiveDecimal()
  allocatedAmount!: Prisma.Decimal | number | string;

  @IsString()
  counterpartyId!: string;

  // See InvestmentsService's CreateInvestmentInput.businessDescription
  // for what this is and why it's required.
  @IsString()
  @MinLength(20)
  businessDescription!: string;
}

export class RecordVaultShariahScreeningInput {
  @IsEnum(ShariahScreeningDecision)
  decision!: ShariahScreeningDecision;

  @IsOptional()
  @IsBoolean()
  interestBearingDebtConcern?: boolean;

  @IsOptional()
  @IsBoolean()
  nonCompliantIncomeConcern?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  flaggedSectorIds?: string[];

  @IsString()
  @IsNotEmpty()
  reviewerNotes!: string;
}

@Injectable()
export class VaultInvestmentsService {
  /**
   * Birr-staff only — investment-style vaults route their pooled
   * confirmed contributions into an instrument the same way an
   * Investment-type Waqf does. Plain CRUD (only *changes* are governed —
   * see changeAllocation below), mirroring InvestmentsService.create()'s
   * own trust level.
   */
  create(input: CreateVaultInvestmentInput, actorUserId: string) {
    return prisma.$transaction((tx) => this.createOne(tx, input, actorUserId));
  }

  private async createOne(tx: Prisma.TransactionClient, input: CreateVaultInvestmentInput, actorUserId: string) {
    const vault = await findVaultOrThrow(tx, input.vaultId);
    if (vault.type !== "investment") {
      throw new BadRequestException(
        `Only investment-style vaults route their pooled contributions into investments — "${vault.name}" is ${vault.type}.`,
      );
    }

    const counterparty = await tx.counterparty.findUnique({ where: { id: input.counterpartyId } });
    if (!counterparty) throw new NotFoundException(`Counterparty "${input.counterpartyId}" not found.`);
    if (counterparty.status !== "active") {
      throw new BadRequestException(
        `"${counterparty.name}" is ${counterparty.status} — not yet approved to receive investment.`,
      );
    }

    await this.assertWithinRaised(input.vaultId, new Prisma.Decimal(input.allocatedAmount), tx);
    await this.assertWithinConcentrationLimit(counterparty, new Prisma.Decimal(input.allocatedAmount), vault.currency, tx);

    const { businessDescription, ...investmentInput } = input;
    const investment = await tx.vaultInvestment.create({ data: { ...investmentInput, currency: vault.currency } });
    // Starts at pending_shariah_review — see VaultShariahScreening's own
    // schema comment.
    await tx.vaultShariahScreening.create({ data: { vaultInvestmentId: investment.id, businessDescription } });
    await tx.auditLog.create({
      data: {
        vaultId: input.vaultId,
        actorType: "birr_staff",
        actorUserId,
        action: "vault_investment.created",
        entityType: "VaultInvestment",
        entityId: investment.id,
        after: investment as any,
      },
    });
    return investment;
  }

  /**
   * shariah_board_member-only — mirrors InvestmentsService
   * .recordShariahScreening exactly, against VaultInvestment/
   * VaultShariahScreening instead.
   */
  async recordShariahScreening(vaultInvestmentId: string, input: RecordVaultShariahScreeningInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const investment = await tx.vaultInvestment.findUnique({
        where: { id: vaultInvestmentId },
        include: { vaultShariahScreening: true },
      });
      if (!investment) throw new NotFoundException(`VaultInvestment "${vaultInvestmentId}" not found.`);
      if (!investment.vaultShariahScreening) {
        throw new NotFoundException(`VaultInvestment "${vaultInvestmentId}" has no Shariah screening on file.`);
      }
      if (investment.vaultShariahScreening.decision) {
        throw new ConflictException("This investment's Shariah screening has already been decided.");
      }

      await tx.vaultShariahScreening.update({
        where: { id: investment.vaultShariahScreening.id },
        data: {
          decision: input.decision,
          interestBearingDebtConcern: input.interestBearingDebtConcern ?? false,
          nonCompliantIncomeConcern: input.nonCompliantIncomeConcern ?? false,
          flaggedSectorIds: input.flaggedSectorIds ?? [],
          reviewerNotes: input.reviewerNotes,
          decidedAt: new Date(),
          decidedByUserId: actorUserId,
        },
      });

      const newStatus: InvestmentStatus = input.decision === "approved" ? "active" : "shariah_rejected";
      const updated = await tx.vaultInvestment.update({ where: { id: vaultInvestmentId }, data: { status: newStatus } });

      await tx.auditLog.create({
        data: {
          vaultId: investment.vaultId,
          actorType: "birr_staff",
          actorUserId,
          action: input.decision === "approved" ? "vault_investment.shariah_approved" : "vault_investment.shariah_rejected",
          entityType: "VaultInvestment",
          entityId: vaultInvestmentId,
          before: investment as any,
          after: updated as any,
        },
      });

      return updated;
    });
  }

  /**
   * Internal only — never exposed behind a public controller route.
   * vault.investment_change is a governed action; the only caller is
   * GovernedActionsService's handler map, on approval, inside its own
   * transaction. Mirrors InvestmentsService.changeAllocation exactly.
   */
  async changeAllocation(id: string, newAllocatedAmount: Prisma.Decimal | number | string, tx: Prisma.TransactionClient) {
    const investment = await tx.vaultInvestment.findUnique({ where: { id } });
    if (!investment) throw new NotFoundException(`VaultInvestment "${id}" not found.`);
    await this.assertWithinRaised(investment.vaultId, new Prisma.Decimal(newAllocatedAmount), tx, id);
    if (investment.counterpartyId) {
      const counterparty = await tx.counterparty.findUnique({ where: { id: investment.counterpartyId } });
      if (counterparty) {
        await this.assertWithinConcentrationLimit(
          counterparty,
          new Prisma.Decimal(newAllocatedAmount),
          investment.currency,
          tx,
          id,
        );
      }
    }
    return tx.vaultInvestment.update({ where: { id }, data: { allocatedAmount: newAllocatedAmount } });
  }

  /**
   * A vault can't invest more than it's actually raised — mirrors
   * InvestmentsService's own assertWithinRaised exactly, against
   * confirmed VaultContribution totals instead of Contribution.
   */
  private async assertWithinRaised(
    vaultId: string,
    additionalAmount: Prisma.Decimal,
    tx: Prisma.TransactionClient,
    excludeInvestmentId?: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "vaults" WHERE id = ${vaultId} FOR UPDATE`;
    const vault = await tx.vault.findUnique({ where: { id: vaultId }, select: { currency: true } });
    const raised = await tx.vaultContribution.aggregate({
      where: { vaultId, ...SPENDABLE_CONTRIBUTION_WHERE, ...(vault?.currency ? { currency: vault.currency } : {}) },
      _sum: { amount: true },
    });
    const amountRaised = raised._sum.amount ?? new Prisma.Decimal(0);

    // See InvestmentsService.assertWithinRaised's own 2026-09-19 comment
    // — pending_shariah_review investments still count.
    const others = await tx.vaultInvestment.findMany({
      where: {
        vaultId,
        status: { in: COMMITTED_INVESTMENT_STATUSES },
        ...(excludeInvestmentId ? { id: { not: excludeInvestmentId } } : {}),
      },
      select: { allocatedAmount: true },
    });
    const alreadyInvested = others.reduce((sum, i) => sum.plus(i.allocatedAmount), new Prisma.Decimal(0));

    if (alreadyInvested.plus(additionalAmount).gt(amountRaised)) {
      const available = amountRaised.minus(alreadyInvested);
      throw new BadRequestException(
        `Only ${available.isNegative() ? 0 : available} of ${amountRaised} raised is uninvested for this vault.`,
      );
    }
  }

  /**
   * Same shared Counterparty.concentrationLimit InvestmentsService's own
   * assertWithinConcentrationLimit enforces — a real cross-cutting
   * fiduciary risk ceiling, not a Vault-specific one. Deliberately sums
   * BOTH Investment and VaultInvestment rows against this counterparty:
   * the whole point of a per-counterparty concentration limit is total
   * exposure across everything Birr has placed with them, and a
   * counterparty doesn't care (or know) whether the money came from a
   * Founder's own waqf or a public Vault. Summing only one table would
   * silently let combined real exposure exceed the configured ceiling.
   */
  private async assertWithinConcentrationLimit(
    counterparty: { id: string; name: string; concentrationLimit: Prisma.Decimal | null; concentrationLimitCurrency: string | null },
    additionalAmount: Prisma.Decimal,
    additionalAmountCurrency: string | null,
    tx: Prisma.TransactionClient,
    excludeInvestmentId?: string,
  ): Promise<void> {
    if (!counterparty.concentrationLimit) return;
    await tx.$queryRaw`SELECT id FROM "counterparties" WHERE id = ${counterparty.id} FOR UPDATE`;
    const limitCurrency = counterparty.concentrationLimitCurrency;
    if (limitCurrency && additionalAmountCurrency && additionalAmountCurrency !== limitCurrency) {
      return;
    }

    // Same 2026-09-19 fix as InvestmentsService's own mirror — pending
    // investments on either side still count toward exposure.
    const [waqfInvestments, vaultInvestments] = await Promise.all([
      tx.investment.findMany({
        where: { counterpartyId: counterparty.id, status: { in: COMMITTED_INVESTMENT_STATUSES } },
        select: { allocatedAmount: true, currency: true },
      }),
      tx.vaultInvestment.findMany({
        where: {
          counterpartyId: counterparty.id,
          status: { in: COMMITTED_INVESTMENT_STATUSES },
          ...(excludeInvestmentId ? { id: { not: excludeInvestmentId } } : {}),
        },
        select: { allocatedAmount: true, currency: true },
      }),
    ]);
    const alreadyInvested = [...waqfInvestments, ...vaultInvestments]
      .filter((i) => !limitCurrency || !i.currency || i.currency === limitCurrency)
      .reduce((sum, i) => sum.plus(i.allocatedAmount), new Prisma.Decimal(0));

    if (alreadyInvested.plus(additionalAmount).gt(counterparty.concentrationLimit)) {
      const available = counterparty.concentrationLimit.minus(alreadyInvested);
      throw new BadRequestException(
        `Only ${available.isNegative() ? 0 : available} of "${counterparty.name}"'s ${counterparty.concentrationLimit} concentration limit is unused (across every waqf and vault combined).`,
      );
    }
  }

  findById(id: string) {
    return prisma.vaultInvestment.findUnique({ where: { id }, include: { vaultShariahScreening: true } });
  }

  list(vaultId?: string) {
    return prisma.vaultInvestment.findMany({
      where: vaultId ? { vaultId } : undefined,
      include: { vaultShariahScreening: true },
      orderBy: { createdAt: "desc" },
    });
  }
}
