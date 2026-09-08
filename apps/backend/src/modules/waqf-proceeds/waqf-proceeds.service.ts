import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { IsNumberString, IsOptional, IsString } from "class-validator";
import { prisma, Prisma } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";
import { WaqfCausesService } from "../waqf-causes/waqf-causes.service";

export class RecordWaqfProceedsInput {
  @IsString()
  waqfId!: string;

  @IsOptional()
  @IsString()
  investmentId?: string;

  @IsNumberString()
  amount!: Prisma.Decimal | number | string;

  @IsString()
  currency!: string;

  @IsString()
  description!: string;
}

@Injectable()
export class WaqfProceedsService {
  private readonly logger = new Logger(WaqfProceedsService.name);

  // forwardRef — WaqfCausesService already depends on this service
  // (sumForWaqf); this is the reverse edge of that same pair, so both
  // sides need forwardRef (see WaqfCausesService's own comment).
  constructor(
    @Inject(forwardRef(() => WaqfCausesService)) private readonly waqfCausesService: WaqfCausesService,
  ) {}

  /**
   * Birr-staff only — investment performance isn't something a Founder
   * observes directly, same trust level as registering an Asset or
   * Investment (plain CRUD, not governed; only *changing* an existing
   * investment's allocation is governed). Append-only by convention (no
   * update/delete method or route exists), same posture as
   * CauseImpactUpdate — a correction is a new, possibly negative, entry.
   *
   * Every successful record automatically re-runs
   * WaqfCausesService.allocateProceedsProportionally() for this waqf,
   * so a cause's proceedsAllocatedAmount always reflects the fund's
   * full recorded pool without a separate staff click — confirmed with
   * the user directly (this used to be manual-only, "staff clicks a
   * button", by an earlier explicit decision; changed here at the
   * user's later request). Best-effort: it runs after record()'s own
   * transaction has already committed the real, primary fact (proceeds
   * were recorded), and its failure — most commonly "this waqf has no
   * causes yet," a normal early-lifecycle state — must never undo or
   * block that. Staff can still re-run it by hand via the Causes
   * section's own control (e.g. right after adding a new cause).
   */
  async record(input: RecordWaqfProceedsInput, actorUserId: string) {
    const proceeds = await prisma.$transaction(async (tx) => {
      // Only an Investment-type waqf ever routes corpus into an
      // instrument at all (InvestmentsService.createOne enforces this
      // on the way in) — recording a "return" against any other type
      // is nonsensical, since there's nothing generating it.
      const waqf = await tx.waqf.findUnique({ where: { id: input.waqfId } });
      if (!waqf) throw new NotFoundException(`Waqf "${input.waqfId}" not found.`);
      if (waqf.type !== "investment") {
        throw new BadRequestException(
          `Only Investment-type Waqf Funds record investment proceeds — "${waqf.name}" is ${waqf.type}.`,
        );
      }
      // WaqfCause.allocatedAmount/proceedsAllocatedAmount carry no
      // currency of their own (see DistributionsService
      // .assertWithinAllocation's own comment on this same gap) — this
      // pool is summed by sumForWaqf() and split across causes by
      // allocateProceedsProportionally() as bare numbers, so a proceeds
      // row in a different currency than the waqf's own corpus would
      // silently inflate that ceiling as if it were the same money
      // (found 2026-09-04, live: a Founder submitting a distribution in
      // a mismatched currency against a ceiling actually computed in
      // another). Anchoring every proceeds row to the one declared
      // corpusCurrency, same as allocate()'s own poolCurrency
      // resolution, is what keeps that ceiling meaningful. Waqfs with no
      // declared corpusCurrency (legacy, predating the corpus-target
      // feature) fall through unchecked — nothing to validate against.
      if (waqf.corpusCurrency && waqf.corpusCurrency !== input.currency) {
        throw new BadRequestException(
          `This waqf's corpus is denominated in ${waqf.corpusCurrency} — proceeds must be recorded in that same currency, not ${input.currency}.`,
        );
      }

      if (input.investmentId) {
        const investment = await tx.investment.findFirst({
          where: { id: input.investmentId, waqfId: input.waqfId },
        });
        if (!investment) {
          throw new NotFoundException(
            `Investment "${input.investmentId}" not found on waqf "${input.waqfId}".`,
          );
        }
      }

      const proceeds = await tx.waqfProceeds.create({ data: { ...input, recordedByUserId: actorUserId } });

      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "waqf_proceeds.recorded",
          entityType: "WaqfProceeds",
          entityId: proceeds.id,
          after: proceeds as any,
        },
      });

      return proceeds;
    });

    try {
      await this.waqfCausesService.allocateProceedsProportionally(input.waqfId, actorUserId);
    } catch (err) {
      // Most commonly "this waqf has no causes yet" (BadRequestException)
      // — a normal, expected state, not a bug. Never lets a best-effort
      // follow-up fail the request that already successfully recorded
      // real proceeds.
      this.logger.error(
        `Couldn't auto-reallocate proceeds for waqf "${input.waqfId}" after recording:`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return proceeds;
  }

  list(waqfId?: string) {
    return prisma.waqfProceeds.findMany({
      where: waqfId ? { waqfId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * The pool WaqfCausesService.allocateProceeds() draws from — Birr
   * staff's proceeds-to-cause allocation, distinct from and additive to
   * the Founder's corpus-based allocate()/allocatedAmount pool (which
   * never reads this, and never has — see allocate()'s own comment).
   * Summed on read, same posture as WaqfsService.attachAmountRaised, so
   * it can never drift from the underlying WaqfProceeds rows.
   */
  async sumForWaqf(waqfId: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<Prisma.Decimal> {
    const result = await client.waqfProceeds.aggregate({ where: { waqfId }, _sum: { amount: true } });
    return result._sum.amount ?? new Prisma.Decimal(0);
  }

  // Founder-Portal read-only visibility — a Founder needs to see their
  // own waqf's recorded proceeds total to know what's available to
  // allocate, but never writes here themselves. Returns null (not an
  // empty array) when the waqf isn't found or isn't theirs, matching
  // AssetsService.listForFounder's convention.
  async listForFounder(waqfId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const waqf = await tx.waqf.findFirst({
        where: { id: waqfId, foundation: { foundationFounders: { some: { founderId } } } },
        select: { id: true },
      });
      if (!waqf) return null;
      return tx.waqfProceeds.findMany({ where: { waqfId }, orderBy: { createdAt: "desc" } });
    });
  }
}
