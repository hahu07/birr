import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, ProgrammeJournalEntrySource, WaqfProgrammePot, prisma, Prisma } from "@birr/db";

export interface ProgrammeJournalLineInput {
  /** The account's code, e.g. "1000" (Endowment cash). */
  accountCode: string;
  debit?: Prisma.Decimal | string;
  credit?: Prisma.Decimal | string;
}

export interface PostClinicJournalEntryInput {
  programmeId: string;
  description: string;
  currency: string;
  source: ProgrammeJournalEntrySource;
  sourceId?: string;
  actorType: ActorType;
  actorUserId?: string;
  lines: ProgrammeJournalLineInput[];
}

const DEBIT_NORMAL: ReadonlySet<string> = new Set(["asset", "expense"]);

/**
 * The clinic waqf's own double-entry ledger (2026-11-17), kept apart from
 * Waqf, Vault and zakah. Every account belongs to one pot, the endowment or
 * the running fund, and an entry must balance within each pot on its own,
 * so money never moves between them. Checked here for a clear message, and
 * again by the database at commit (clinic_journal_check_balanced).
 */
@Injectable()
export class ProgrammeLedgerService {
  /** Posts one entry inside the caller's transaction. */
  async post(tx: Prisma.TransactionClient, input: PostClinicJournalEntryInput) {
    if (input.lines.length < 2) {
      throw new BadRequestException("A journal entry needs at least two lines — a debit and a credit.");
    }
    const codes = [...new Set(input.lines.map((l) => l.accountCode))];
    const accounts = await tx.programmeLedgerAccount.findMany({ where: { code: { in: codes } } });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const totals = new Map<WaqfProgrammePot, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    for (const line of input.lines) {
      const account = byCode.get(line.accountCode);
      if (!account) throw new NotFoundException(`Clinic ledger account "${line.accountCode}" doesn't exist.`);
      const debit = new Prisma.Decimal(line.debit ?? 0);
      const credit = new Prisma.Decimal(line.credit ?? 0);
      if (debit.gt(0) === credit.gt(0)) {
        throw new BadRequestException("Each journal entry line must be exactly one of a debit or a credit.");
      }
      const pot = totals.get(account.pot) ?? { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
      totals.set(account.pot, { debit: pot.debit.plus(debit), credit: pot.credit.plus(credit) });
    }
    for (const [pot, { debit, credit }] of totals) {
      if (!debit.equals(credit)) {
        throw new BadRequestException(
          `This entry doesn't balance within the ${pot === "endowment" ? "endowment" : "running fund"} (debits ${debit} ≠ credits ${credit}). The endowment and the running fund never mix.`,
        );
      }
    }
    return tx.programmeJournalEntry.create({
      data: {
        programmeId: input.programmeId,
        description: input.description,
        currency: input.currency,
        source: input.source,
        sourceId: input.sourceId,
        actorType: input.actorType,
        actorUserId: input.actorUserId,
        lines: {
          create: input.lines.map((l) => ({
            ledgerAccountId: byCode.get(l.accountCode)!.id,
            debit: l.debit ?? 0,
            credit: l.credit ?? 0,
          })),
        },
      },
      include: { lines: true },
    });
  }

  /** Each account's balance for one clinic waqf in one currency, grouped by pot. */
  async balances(programmeId: string, currency = "NGN") {
    const accounts = await prisma.programmeLedgerAccount.findMany({ orderBy: { code: "asc" } });
    const sums = await prisma.programmeJournalEntryLine.groupBy({
      by: ["ledgerAccountId"],
      where: { journalEntry: { programmeId, currency } },
      _sum: { debit: true, credit: true },
    });
    const byAccount = new Map(sums.map((s) => [s.ledgerAccountId, s._sum]));
    const rows = accounts.map((a) => {
      const debit = byAccount.get(a.id)?.debit ?? new Prisma.Decimal(0);
      const credit = byAccount.get(a.id)?.credit ?? new Prisma.Decimal(0);
      const balance = DEBIT_NORMAL.has(a.type) ? debit.minus(credit) : credit.minus(debit);
      return { code: a.code, name: a.name, type: a.type, pot: a.pot, balance: balance.toFixed(2) };
    });
    return {
      currency,
      endowment: rows.filter((r) => r.pot === "endowment"),
      running: rows.filter((r) => r.pot === "running"),
    };
  }
}
