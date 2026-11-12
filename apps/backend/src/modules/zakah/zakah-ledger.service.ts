import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, prisma, Prisma, ZakahJournalEntrySource, ZakahPool } from "@birr/db";

// Created by the migration that adds the zakah ledger tables.
export const ZAKAH_BANK_ACCOUNT_CODE = "1000";
export const ZAKAH_HELD_FOR_RECIPIENTS_ACCOUNT_CODE = "2000";

/** Each pool's own "held for recipients" account; all three share the bank account. */
export const HELD_ACCOUNT_BY_POOL: Record<ZakahPool, string> = {
  mal: ZAKAH_HELD_FOR_RECIPIENTS_ACCOUNT_CODE,
  fitr_food: "2100",
  fitr_cash: "2200",
};

export interface ZakahJournalLineInput {
  ledgerAccountId: string;
  debit?: Prisma.Decimal | string;
  credit?: Prisma.Decimal | string;
}

export interface PostZakahJournalEntryInput {
  description: string;
  currency: string;
  source: ZakahJournalEntrySource;
  sourceId?: string;
  actorType: ActorType;
  actorUserId?: string;
  lines: ZakahJournalLineInput[];
}

const DEBIT_NORMAL: ReadonlySet<string> = new Set(["asset", "expense"]);

/**
 * Zakah's own double-entry ledger — the same shape as VaultLedgerService,
 * kept separate so zakah never shares a journal with Vault or Waqf money.
 * Zakah is held as each payer's agent, so a received payment is a
 * liability (held for recipients), not revenue.
 */
@Injectable()
export class ZakahLedgerService {
  /**
   * Posts one balanced entry inside the caller's transaction. Balance is
   * checked here (it spans sibling rows, which a CHECK constraint can't);
   * one-side-per-line and append-only are enforced by the database.
   */
  async post(tx: Prisma.TransactionClient, input: PostZakahJournalEntryInput) {
    if (input.lines.length < 2) {
      throw new BadRequestException("A journal entry needs at least two lines — a debit and a credit.");
    }
    let totalDebit = new Prisma.Decimal(0);
    let totalCredit = new Prisma.Decimal(0);
    for (const line of input.lines) {
      const debit = new Prisma.Decimal(line.debit ?? 0);
      const credit = new Prisma.Decimal(line.credit ?? 0);
      if (debit.gt(0) === credit.gt(0)) {
        throw new BadRequestException("Each journal entry line must be exactly one of a debit or a credit.");
      }
      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
    }
    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException(`Journal entry doesn't balance: debits ${totalDebit} ≠ credits ${totalCredit}.`);
    }
    return tx.zakahJournalEntry.create({
      data: {
        description: input.description,
        currency: input.currency,
        source: input.source,
        sourceId: input.sourceId,
        actorType: input.actorType,
        actorUserId: input.actorUserId,
        lines: {
          create: input.lines.map((l) => ({ ledgerAccountId: l.ledgerAccountId, debit: l.debit ?? 0, credit: l.credit ?? 0 })),
        },
      },
      include: { lines: true },
    });
  }

  async getAccountByCode(tx: Prisma.TransactionClient, code: string) {
    const account = await tx.zakahLedgerAccount.findUnique({ where: { code } });
    if (!account) throw new NotFoundException(`Zakah ledger account "${code}" is missing — it's created by the zakah ledger migration.`);
    return account;
  }

  /** Each account's balance in one currency, for the Ops Console. */
  async balances(currency = "NGN") {
    const accounts = await prisma.zakahLedgerAccount.findMany({ orderBy: { code: "asc" } });
    const sums = await prisma.zakahJournalEntryLine.groupBy({
      by: ["ledgerAccountId"],
      where: { journalEntry: { currency } },
      _sum: { debit: true, credit: true },
    });
    const byAccount = new Map(sums.map((s) => [s.ledgerAccountId, s._sum]));
    return accounts.map((a) => {
      const debit = byAccount.get(a.id)?.debit ?? new Prisma.Decimal(0);
      const credit = byAccount.get(a.id)?.credit ?? new Prisma.Decimal(0);
      const balance = DEBIT_NORMAL.has(a.type) ? debit.minus(credit) : credit.minus(debit);
      return { code: a.code, name: a.name, type: a.type, debit: debit.toFixed(2), credit: credit.toFixed(2), balance: balance.toFixed(2) };
    });
  }
}
