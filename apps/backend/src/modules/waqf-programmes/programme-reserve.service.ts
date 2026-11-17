import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma, Prisma } from "@birr/db";
import { ProgrammeLedgerService } from "./programme-ledger.service";

type Db = Prisma.TransactionClient | typeof prisma;

const naira = (amount: Prisma.Decimal) => `₦${Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A clinic waqf's equipment replacement reserve (2026-11-17, clinic slice 9).
 *
 * - The share: the Board sets what percentage of the endowment's income is
 *   set aside (waqf_programme.reserve_share_set; a Mutawalli Officer proposes).
 * - Setting aside: every income receipt moves that share from running fund
 *   cash into the reserve (1150 / 1100, both running fund), automatically,
 *   in the same transaction that records the income.
 * - Spending it: only on replacing registered equipment, through endowment
 *   spending's approve, pay and confirm flow (ProgrammeSpendingService, kind
 *   reserve_replacement).
 */
@Injectable()
export class ProgrammeReserveService {
  constructor(private readonly ledger: ProgrammeLedgerService) {}

  /** What the reserve holds (1150). */
  async balance(db: Db, programmeId: string) {
    const sums = await db.programmeJournalEntryLine.aggregate({
      where: { journalEntry: { programmeId, currency: "NGN" }, ledgerAccount: { code: "1150" } },
      _sum: { debit: true, credit: true },
    });
    return (sums._sum.debit ?? new Prisma.Decimal(0)).minus(sums._sum.credit ?? 0);
  }

  /**
   * Sets aside the reserve's share of one income receipt. Call inside the
   * transaction that records the income, before its audit row; locks the
   * clinic row (shared) so the share can't change underneath it.
   */
  async setAsideFromIncome(tx: Prisma.TransactionClient, programmeId: string, incomeId: string, income: Prisma.Decimal) {
    await tx.$queryRaw`SELECT "id" FROM "waqf_programmes" WHERE "id" = ${programmeId} FOR SHARE`;
    const clinic = await tx.waqfProgramme.findUniqueOrThrow({ where: { id: programmeId }, select: { reserveSharePercent: true } });
    // Rounded down, so the reserve never takes more than its share.
    const amount = income.times(clinic.reserveSharePercent).dividedBy(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    if (amount.lte(0)) return null;
    await this.ledger.post(tx, {
      programmeId,
      description: `${clinic.reserveSharePercent}% of income set aside for replacing equipment`,
      currency: "NGN",
      source: "reserve_set_aside",
      sourceId: incomeId,
      actorType: "system",
      lines: [
        { accountCode: "1150", debit: amount },
        { accountCode: "1100", credit: amount },
      ],
    });
    return amount;
  }

  // ---- waqf_programme.reserve_share_set (checker: the Board) ----

  private parse(payload: unknown) {
    const p = (payload ?? {}) as Record<string, unknown>;
    if (typeof p.programmeId !== "string") throw new BadRequestException("payload.programmeId is required.");
    if (typeof p.percent !== "number" || !Number.isInteger(p.percent) || p.percent < 0 || p.percent > 100) {
      throw new BadRequestException("payload.percent must be a whole number from 0 to 100.");
    }
    return { programmeId: p.programmeId, percent: p.percent };
  }

  private async find(db: Db, programmeId: string) {
    const clinic = await db.waqfProgramme.findUnique({ where: { id: programmeId } });
    if (!clinic) throw new NotFoundException(`Clinic waqf "${programmeId}" not found.`);
    return clinic;
  }

  async validateShareProposal(payload: unknown) {
    const { programmeId, percent } = this.parse(payload);
    const clinic = await this.find(prisma, programmeId);
    if (clinic.status !== "established") throw new BadRequestException(`${clinic.name} isn't established yet.`);
    if (clinic.reserveSharePercent === percent) throw new BadRequestException(`The reserve already takes ${percent}% of income.`);
  }

  async checkDuplicateShare(payload: unknown) {
    const { programmeId } = this.parse(payload);
    const pending = await prisma.governedAction.findFirst({
      where: { status: "proposed", permission: { key: "waqf_programme.reserve_share_set" }, payload: { path: ["programmeId"], equals: programmeId } },
    });
    if (pending) throw new ConflictException("A change to this reserve's share is already waiting for the Board — check the Approvals queue.");
  }

  async describeShare(payload: unknown): Promise<string> {
    const { programmeId, percent } = this.parse(payload);
    const clinic = await this.find(prisma, programmeId);
    return (
      `Set aside ${percent}% of ${clinic.name}'s endowment income for replacing its equipment (now ${clinic.reserveSharePercent}%). ` +
      `It applies to income recorded from approval on; the rest stays in the running fund for care.`
    );
  }

  async currentShareState(payload: unknown): Promise<Record<string, unknown>> {
    const { programmeId } = this.parse(payload);
    const clinic = await this.find(prisma, programmeId);
    return { currentPercent: clinic.reserveSharePercent, reserveHolds: naira(await this.balance(prisma, programmeId)) };
  }

  async approveShare(payload: unknown, governedActionId: string, tx: Prisma.TransactionClient) {
    const { programmeId, percent } = this.parse(payload);
    await tx.$queryRaw`SELECT "id" FROM "waqf_programmes" WHERE "id" = ${programmeId} FOR UPDATE`;
    const before = await this.find(tx, programmeId);
    const after = await tx.waqfProgramme.update({ where: { id: programmeId }, data: { reserveSharePercent: percent, reserveShareActionId: governedActionId } });
    return { before, after };
  }
}
