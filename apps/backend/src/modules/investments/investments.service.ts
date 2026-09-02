import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsEnum, IsNumberString, IsString } from "class-validator";
import { prisma, Prisma, InvestmentInstrumentType } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";

export class CreateInvestmentInput {
  @IsString()
  waqfId!: string;

  @IsString()
  name!: string;

  @IsEnum(InvestmentInstrumentType)
  instrumentType!: InvestmentInstrumentType;

  // See AssetsService's CreateAssetInput.estimatedValue for why this is
  // @IsNumberString rather than @IsNumber.
  @IsNumberString()
  allocatedAmount!: Prisma.Decimal | number | string;

  // Required — who actually holds this money (see Counterparty's own
  // schema comment). Must already be `active` (both fiduciary gates
  // passed) before it can receive a single dollar of waqf money.
  @IsString()
  counterpartyId!: string;
}

@Injectable()
export class InvestmentsService {
  // Not maker-checker gated (only investment.change is), but still a
  // create on a governed entity per CLAUDE.md's audit-trail
  // non-negotiable — wrapped in a transaction so the create and its
  // audit row are atomic.
  create(input: CreateInvestmentInput, actorUserId: string) {
    return prisma.$transaction((tx) => this.createOne(tx, input, actorUserId));
  }

  /**
   * The real body of create() above, pulled out so
   * InvestmentPlacementsService can call it once per waqf inside one
   * shared transaction (a bulk placement across many waqfs), reusing
   * every check as-is — including assertWithinConcentrationLimit
   * correctly seeing each earlier iteration's just-created row within
   * the same `tx`, so a placement's combined total is checked against
   * the limit for free, not just each leg individually. Public (not
   * private) for that cross-module reuse, but still no direct
   * controller route of its own — every caller goes through either
   * create() above or InvestmentPlacementsService.
   *
   * Restricted to Investment-type waqfs — only that type routes its
   * raised corpus into an investment venue at all; every other type
   * (Asset/Project/Hybrid) goes directly toward its stated purpose, with
   * no investment step to register.
   */
  async createOne(
    tx: Prisma.TransactionClient,
    input: CreateInvestmentInput & { placementId?: string },
    actorUserId: string,
  ) {
    const waqf = await tx.waqf.findUnique({ where: { id: input.waqfId } });
    if (!waqf) throw new NotFoundException(`Waqf "${input.waqfId}" not found.`);
    if (waqf.type !== "investment") {
      throw new BadRequestException(
        `Only Investment-type Waqf Funds route their corpus into investments — "${waqf.name}" is ${waqf.type}.`,
      );
    }

    const counterparty = await tx.counterparty.findUnique({ where: { id: input.counterpartyId } });
    if (!counterparty) throw new NotFoundException(`Counterparty "${input.counterpartyId}" not found.`);
    if (counterparty.status !== "active") {
      throw new BadRequestException(
        `"${counterparty.name}" is ${counterparty.status} — not yet approved to receive investment.`,
      );
    }

    await this.assertWithinRaised(input.waqfId, new Prisma.Decimal(input.allocatedAmount), tx);
    await this.assertWithinConcentrationLimit(counterparty, new Prisma.Decimal(input.allocatedAmount), waqf.corpusCurrency, tx);

    const investment = await tx.investment.create({ data: input });
    await tx.auditLog.create({
      data: {
        waqfId: input.waqfId,
        actorType: "birr_staff",
        actorUserId,
        action: "investment.created",
        entityType: "Investment",
        entityId: investment.id,
        after: investment as any,
      },
    });
    return investment;
  }

  /**
   * Internal only — never expose this behind a public controller route.
   * investment.change is a governed action (see schema.prisma's comment
   * on Investment); the only caller is GovernedActionsService's handler
   * map, on approval, inside its own transaction.
   */
  async changeAllocation(
    id: string,
    newAllocatedAmount: Prisma.Decimal | number | string,
    tx: Prisma.TransactionClient,
  ) {
    const investment = await tx.investment.findUnique({ where: { id }, include: { waqf: { select: { corpusCurrency: true } } } });
    if (!investment) throw new NotFoundException(`Investment "${id}" not found.`);
    await this.assertWithinRaised(investment.waqfId, new Prisma.Decimal(newAllocatedAmount), tx, id);
    if (investment.counterpartyId) {
      const counterparty = await tx.counterparty.findUnique({ where: { id: investment.counterpartyId } });
      if (counterparty) {
        await this.assertWithinConcentrationLimit(
          counterparty,
          new Prisma.Decimal(newAllocatedAmount),
          investment.waqf.corpusCurrency,
          tx,
          id,
        );
      }
    }
    return tx.investment.update({
      where: { id },
      data: { allocatedAmount: newAllocatedAmount },
    });
  }

  /**
   * A waqf can't invest more corpus than it's actually raised — sums
   * every other *active* investment's allocatedAmount (a liquidated one
   * has released its corpus back, so it no longer counts against the
   * ceiling) plus the amount being committed now, against the waqf's
   * live amountRaised (same aggregate as WaqfsService.attachAmountRaised
   * and WaqfCausesService.allocate's own pool). `excludeInvestmentId`
   * lets changeAllocation() re-check without double-counting the row
   * being changed against itself.
   */
  private async assertWithinRaised(
    waqfId: string,
    additionalAmount: Prisma.Decimal,
    tx: Prisma.TransactionClient,
    excludeInvestmentId?: string,
  ): Promise<void> {
    // Row-locked for the rest of this transaction so two concurrent
    // investment creates/changes against the same waqf can't both read
    // the pre-commit "already invested" sum below and jointly exceed the
    // raised-corpus ceiling (TOCTOU).
    await tx.$queryRaw`SELECT id FROM "waqfs" WHERE id = ${waqfId} FOR UPDATE`;
    // Scoped to the waqf's declared corpus currency, same reasoning as
    // WaqfsService.attachAmountRaised — Investment.allocatedAmount has no
    // currency field of its own, so this ceiling implicitly assumes every
    // confirmed Contribution counted here shares one currency. Without
    // this filter, a stray off-currency Contribution would inflate (or
    // deflate) the raw number this gate compares real money-movement
    // against.
    const waqf = await tx.waqf.findUnique({ where: { id: waqfId }, select: { corpusCurrency: true } });
    const raised = await tx.contribution.aggregate({
      where: {
        waqfId,
        status: "confirmed",
        ...(waqf?.corpusCurrency ? { currency: waqf.corpusCurrency } : {}),
      },
      _sum: { amount: true },
    });
    const amountRaised = raised._sum.amount ?? new Prisma.Decimal(0);

    const others = await tx.investment.findMany({
      where: {
        waqfId,
        status: "active",
        ...(excludeInvestmentId ? { id: { not: excludeInvestmentId } } : {}),
      },
      select: { allocatedAmount: true },
    });
    const alreadyInvested = others.reduce((sum, i) => sum.plus(i.allocatedAmount), new Prisma.Decimal(0));

    if (alreadyInvested.plus(additionalAmount).gt(amountRaised)) {
      const available = amountRaised.minus(alreadyInvested);
      throw new BadRequestException(
        `Only ${available.isNegative() ? 0 : available} of ${amountRaised} raised is uninvested for this waqf.`,
      );
    }
  }

  /**
   * Risk & Compliance's ceiling on total exposure to one counterparty,
   * summed across every waqf combined — not per-waqf like
   * assertWithinRaised above. Null concentrationLimit means none has
   * been configured yet, in which case this is a no-op (same "flags
   * only once you opt in" posture as most admin-configurable ceilings in
   * this codebase). `excludeInvestmentId` mirrors assertWithinRaised's
   * own re-check convention.
   */
  private async assertWithinConcentrationLimit(
    counterparty: { id: string; name: string; concentrationLimit: Prisma.Decimal | null; concentrationLimitCurrency: string | null },
    additionalAmount: Prisma.Decimal,
    additionalAmountCurrency: string | null,
    tx: Prisma.TransactionClient,
    excludeInvestmentId?: string,
  ): Promise<void> {
    if (!counterparty.concentrationLimit) return;
    // Row-locked — same TOCTOU reasoning as assertWithinRaised, but
    // scoped to the counterparty, since this ceiling spans investments
    // across every waqf combined against one counterparty.
    await tx.$queryRaw`SELECT id FROM "counterparties" WHERE id = ${counterparty.id} FOR UPDATE`;
    const limitCurrency = counterparty.concentrationLimitCurrency;
    // The limit is denominated in one currency — Investment itself has no
    // currency field (see this model's own schema comment), it inherits
    // its waqf's corpusCurrency. Only skip/exclude on a KNOWN mismatch
    // (both currencies present and different) — a waqf with no
    // corpusCurrency recorded is treated as possibly the same currency,
    // not excluded, since under-counting real exposure against a risk
    // ceiling is the more dangerous failure direction than over-counting
    // it (a null corpusCurrency shouldn't be a way to invest around this
    // limit unchecked). No FX conversion exists anywhere in this
    // codebase, so a *known* different currency genuinely has no
    // meaningful ceiling to compare against here.
    if (limitCurrency && additionalAmountCurrency && additionalAmountCurrency !== limitCurrency) {
      return;
    }

    const others = await tx.investment.findMany({
      where: {
        counterpartyId: counterparty.id,
        status: "active",
        ...(excludeInvestmentId ? { id: { not: excludeInvestmentId } } : {}),
      },
      select: { allocatedAmount: true, waqf: { select: { corpusCurrency: true } } },
    });
    const alreadyInvested = others
      .filter((i) => !limitCurrency || !i.waqf.corpusCurrency || i.waqf.corpusCurrency === limitCurrency)
      .reduce((sum, i) => sum.plus(i.allocatedAmount), new Prisma.Decimal(0));

    if (alreadyInvested.plus(additionalAmount).gt(counterparty.concentrationLimit)) {
      const available = counterparty.concentrationLimit.minus(alreadyInvested);
      throw new BadRequestException(
        `Only ${available.isNegative() ? 0 : available} of "${counterparty.name}"'s ${counterparty.concentrationLimit} concentration limit is unused (across every waqf combined).`,
      );
    }
  }

  findById(id: string) {
    return prisma.investment.findUnique({ where: { id } });
  }

  list(waqfId?: string) {
    return prisma.investment.findMany({
      where: waqfId ? { waqfId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  // Founder-Portal read-only visibility into their own waqf's investment
  // allocations — an instrument holding, not a person, so no PII concern
  // (unlike Beneficiary). Same null-means-not-found-or-not-theirs
  // convention as AssetsService.listForFounder.
  async listForFounder(waqfId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const waqf = await tx.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId } } } },
        select: { id: true },
      });
      if (!waqf) return null;
      return tx.investment.findMany({ where: { waqfId, deletedAt: null }, orderBy: { createdAt: "desc" } });
    });
  }
}
