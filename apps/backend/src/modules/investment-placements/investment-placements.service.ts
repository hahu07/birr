import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ArrayMinSize, IsArray, IsEnum, IsNumberString, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { prisma, Prisma, InvestmentInstrumentType } from "@birr/db";
import { InvestmentsService } from "../investments/investments.service";
import { splitProRata } from "../../common/money/pro-rata";

export class PlacementAllocationInput {
  @IsString()
  waqfId!: string;

  // See InvestmentsService's CreateInvestmentInput.allocatedAmount for
  // why this is @IsNumberString rather than @IsNumber.
  @IsNumberString()
  amount!: Prisma.Decimal | number | string;
}

export class CreateInvestmentPlacementInput {
  @IsString()
  name!: string;

  @IsEnum(InvestmentInstrumentType)
  instrumentType!: InvestmentInstrumentType;

  @IsString()
  counterpartyId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PlacementAllocationInput)
  allocations!: PlacementAllocationInput[];
}

export class RecordPlacementProceedsInput {
  @IsNumberString()
  amount!: Prisma.Decimal | number | string;

  @IsString()
  currency!: string;

  @IsString()
  description!: string;
}

@Injectable()
export class InvestmentPlacementsService {
  constructor(private readonly investmentsService: InvestmentsService) {}

  /**
   * Bulk-places one counterparty+instrument tranche across many Waqf
   * Funds at once, instead of one POST /investments per fund. All or
   * nothing: every allocation runs inside one $transaction, reusing
   * InvestmentsService.createOne()'s existing per-waqf check (raised-
   * corpus ceiling) and per-counterparty check (concentration limit —
   * correctly seeing each earlier leg of this same placement within the
   * shared tx, so the placement's *combined* total is what's actually
   * checked against the limit, not each leg in isolation) — one waqf
   * failing its own check rolls back every other leg too, so a
   * placement never ends up half-created.
   */
  async create(input: CreateInvestmentPlacementInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const counterparty = await tx.counterparty.findUnique({ where: { id: input.counterpartyId } });
      if (!counterparty) throw new NotFoundException(`Counterparty "${input.counterpartyId}" not found.`);

      const waqfIds = input.allocations.map((a) => a.waqfId);
      const waqfs = await tx.waqf.findMany({ where: { id: { in: waqfIds } } });
      const foundWaqfIds = new Set(waqfs.map((w) => w.id));
      const missingWaqfIds = [...new Set(waqfIds.filter((id) => !foundWaqfIds.has(id)))];
      if (missingWaqfIds.length > 0) {
        throw new NotFoundException(`Waqf(s) not found: ${missingWaqfIds.join(", ")}`);
      }

      // Investment itself has no currency field — it inherits its own
      // waqf's corpusCurrency (see InvestmentsSection.tsx's
      // corpusCurrency prop). Single-waqf creation never had to check
      // this; a placement spanning waqfs with different corpus
      // currencies would produce a nonsensical combined total.
      const currencies = new Set(waqfs.map((w) => w.corpusCurrency ?? "(none set)"));
      if (currencies.size > 1) {
        throw new BadRequestException(
          `Every fund in one placement must share a corpus currency — got ${[...currencies].join(", ")}.`,
        );
      }

      const placement = await tx.investmentPlacement.create({
        data: {
          name: input.name,
          instrumentType: input.instrumentType,
          counterpartyId: input.counterpartyId,
          createdByUserId: actorUserId,
        },
      });
      // waqfId: null — a placement spans every fund in input.allocations,
      // not one single waqf, same "no single owning waqf" posture as
      // counterparty.onboard's own audit entry. Each child Investment leg
      // still gets its own waqf-scoped audit row below via createOne().
      await tx.auditLog.create({
        data: {
          waqfId: null,
          actorType: "birr_staff",
          actorUserId,
          action: "investment_placement.created",
          entityType: "InvestmentPlacement",
          entityId: placement.id,
          after: placement as any,
        },
      });

      const investments = [];
      for (const allocation of input.allocations) {
        const investment = await this.investmentsService.createOne(
          tx,
          {
            waqfId: allocation.waqfId,
            name: input.name,
            instrumentType: input.instrumentType,
            allocatedAmount: allocation.amount,
            counterpartyId: input.counterpartyId,
            placementId: placement.id,
          },
          actorUserId,
        );
        investments.push(investment);
      }

      return { ...placement, investments };
    });
  }

  async findById(id: string) {
    const placement = await prisma.investmentPlacement.findUnique({
      where: { id },
      include: {
        counterparty: true,
        investments: {
          include: { waqf: { select: { id: true, name: true, foundation: { select: { id: true, name: true } } } } },
        },
      },
    });
    if (!placement) throw new NotFoundException(`Investment placement "${id}" not found.`);
    return placement;
  }

  list(counterpartyId?: string) {
    return prisma.investmentPlacement.findMany({
      where: counterpartyId ? { counterpartyId } : undefined,
      include: { investments: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Records one incoming return on the whole placement and splits it
   * pro-rata across every contributing waqf's own WaqfProceeds, weighted
   * by each fund's share of the placement's total allocatedAmount —
   * instead of an officer hand-calculating each fund's cut and recording
   * N separate entries. Plain CRUD, not governed — same posture as
   * WaqfProceedsService.record() itself. Confirmed safe to be purely
   * additive: WaqfProceeds has zero downstream effect on Cause
   * Allocation, which always draws from amountRaised regardless of waqf
   * type — see WaqfCausesService.allocate()'s own comment.
   */
  async recordProceeds(placementId: string, input: RecordPlacementProceedsInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const placement = await tx.investmentPlacement.findUnique({
        where: { id: placementId },
        include: { investments: { where: { status: "active" } } },
      });
      if (!placement) throw new NotFoundException(`Investment placement "${placementId}" not found.`);
      if (placement.investments.length === 0) {
        throw new BadRequestException("This placement has no active investments to split proceeds across.");
      }

      const shares = splitProRata(
        new Prisma.Decimal(input.amount),
        placement.investments.map((i) => ({ key: i.id, weight: i.allocatedAmount })),
      );

      const proceedsRows = [];
      for (const investment of placement.investments) {
        const amount = shares.get(investment.id)!;
        const proceeds = await tx.waqfProceeds.create({
          data: {
            waqfId: investment.waqfId,
            investmentId: investment.id,
            amount,
            currency: input.currency,
            description: input.description,
            recordedByUserId: actorUserId,
          },
        });
        await tx.auditLog.create({
          data: {
            waqfId: investment.waqfId,
            actorType: "birr_staff",
            actorUserId,
            action: "waqf_proceeds.recorded",
            entityType: "WaqfProceeds",
            entityId: proceeds.id,
            after: proceeds as any,
          },
        });
        proceedsRows.push(proceeds);
      }
      return proceedsRows;
    });
  }
}
