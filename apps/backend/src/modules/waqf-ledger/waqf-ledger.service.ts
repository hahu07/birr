import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, prisma, Prisma, VaultJournalEntrySource } from "@birr/db";

export interface JournalEntryLineInput {
  ledgerAccountId: string;
  debit?: Prisma.Decimal | number | string;
  credit?: Prisma.Decimal | number | string;
}

export interface PostJournalEntryInput {
  waqfId: string;
  description: string;
  currency: string;
  source: VaultJournalEntrySource;
  sourceId?: string;
  actorType: ActorType;
  actorUserId?: string;
  lines: JournalEntryLineInput[];
}

export interface LedgerAccountBalance {
  ledgerAccountId: string;
  code: string;
  name: string;
  type: string;
  debit: string;
  credit: string;
  // debit-normal accounts (asset/expense) show debit - credit; credit-
  // normal accounts (liability/equity/revenue) show credit - debit.
  balance: string;
}

const DEBIT_NORMAL: ReadonlySet<string> = new Set(["asset", "expense"]);

// Well-known codes the auto-posting hooks reference — must match
// seed-data.ts's own waqfLedgerAccounts exactly. Centralized here
// (rather than each hook hardcoding its own string literal) so the two
// can never drift out of sync silently, same convention as
// VaultLedgerService's own exported codes.
export const CASH_AND_BANK_ACCOUNT_CODE = "1000";
export const CONTRIBUTIONS_REVENUE_ACCOUNT_CODE = "4000";
export const PROGRAM_EXPENSES_ACCOUNT_CODE = "5000";

/**
 * Founder/Waqf-side counterpart to VaultLedgerService — same posting
 * engine, same enforcement, ported wholesale rather than redesigned
 * (2026-09-15, see WaqfLedgerAccount's own schema comment for why this
 * exists at all). Additive to, never a replacement for,
 * Contribution/Distribution/WaqfsService's own amountRaised-style
 * reads, which keep working exactly as before.
 */
@Injectable()
export class WaqfLedgerService {
  /**
   * Takes the caller's own transaction (this always fires as one step
   * of a larger write — confirming a contribution, marking a
   * distribution paid, recording an expense — never as its own
   * standalone transaction) and posts one balanced journal entry.
   * sum(debit) == sum(credit) across every line is enforced here, same
   * "careful transaction, not a constraint that doesn't fit the shape"
   * reasoning as VaultLedgerService.post(). The narrower "one line
   * can't be both a debit and a credit" case is closed at the DB level
   * (waqf_debit_xor_credit).
   */
  async post(tx: Prisma.TransactionClient, input: PostJournalEntryInput) {
    if (input.lines.length < 2) {
      throw new BadRequestException("A journal entry needs at least two lines — a debit and a credit.");
    }

    let totalDebit = new Prisma.Decimal(0);
    let totalCredit = new Prisma.Decimal(0);
    for (const line of input.lines) {
      const debit = new Prisma.Decimal(line.debit ?? 0);
      const credit = new Prisma.Decimal(line.credit ?? 0);
      if (debit.gt(0) === credit.gt(0)) {
        throw new BadRequestException("Each journal entry line must be exactly one of a debit or a credit, never both, never neither.");
      }
      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
    }
    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException(
        `Journal entry doesn't balance — debits (${totalDebit}) must equal credits (${totalCredit}).`,
      );
    }

    return tx.waqfJournalEntry.create({
      data: {
        waqfId: input.waqfId,
        description: input.description,
        currency: input.currency,
        source: input.source,
        sourceId: input.sourceId,
        actorType: input.actorType,
        actorUserId: input.actorUserId,
        lines: {
          create: input.lines.map((line) => ({
            ledgerAccountId: line.ledgerAccountId,
            debit: new Prisma.Decimal(line.debit ?? 0),
            credit: new Prisma.Decimal(line.credit ?? 0),
          })),
        },
      },
      include: { lines: true },
    });
  }

  /** Looked up by code, not name — codes are the stable identifier the auto-posting hooks reference (see seed-data.ts's own waqfLedgerAccounts), always called from within that hook's own transaction. */
  async getAccountByCode(tx: Prisma.TransactionClient, code: string) {
    const account = await tx.waqfLedgerAccount.findFirst({ where: { code, deletedAt: null } });
    if (!account) throw new NotFoundException(`Ledger account "${code}" not found — has the seed run?`);
    return account;
  }

  async trialBalance(waqfId: string, currency: string): Promise<LedgerAccountBalance[]> {
    const lines = await prisma.waqfJournalEntryLine.findMany({
      where: { journalEntry: { waqfId, currency } },
      include: { ledgerAccount: true },
    });
    return this.summarize(lines);
  }

  /** Revenue accounts minus expense accounts — a nonprofit "income & expenditure statement," not a for-profit P&L. Asset/liability/equity accounts are excluded (that's the trial balance's job). */
  async incomeStatement(waqfId: string, currency: string): Promise<LedgerAccountBalance[]> {
    const lines = await prisma.waqfJournalEntryLine.findMany({
      where: { journalEntry: { waqfId, currency }, ledgerAccount: { type: { in: ["revenue", "expense"] } } },
      include: { ledgerAccount: true },
    });
    return this.summarize(lines);
  }

  /**
   * Real committed program spend, per currency — the combined balance
   * of every expense-type account, not just the one system-default
   * "Program Expenses" (5000) row. Mirrors VaultLedgerService
   * .spentByCurrency() exactly, ported alongside it rather than
   * re-deriving the same bug independently — a paid Distribution always
   * posts to the one hardcoded account, but a recorded WaqfExpense
   * posts to whichever expense sub-account staff actually chose.
   */
  async spentByCurrency(waqfId: string): Promise<{ currency: string; amount: string }[]> {
    const lines = await prisma.waqfJournalEntryLine.findMany({
      where: { ledgerAccount: { type: "expense" }, journalEntry: { waqfId } },
      include: { journalEntry: { select: { currency: true } } },
    });

    const byCurrency = new Map<string, Prisma.Decimal>();
    for (const line of lines) {
      const currency = line.journalEntry.currency;
      const current = byCurrency.get(currency) ?? new Prisma.Decimal(0);
      byCurrency.set(currency, current.plus(line.debit).minus(line.credit));
    }
    return [...byCurrency.entries()].map(([currency, amount]) => ({ currency, amount: amount.toString() }));
  }

  private summarize(
    lines: { ledgerAccountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal; ledgerAccount: { code: string; name: string; type: string } }[],
  ): LedgerAccountBalance[] {
    const byAccount = new Map<string, LedgerAccountBalance>();
    for (const line of lines) {
      const existing = byAccount.get(line.ledgerAccountId);
      const debit = (existing ? new Prisma.Decimal(existing.debit) : new Prisma.Decimal(0)).plus(line.debit);
      const credit = (existing ? new Prisma.Decimal(existing.credit) : new Prisma.Decimal(0)).plus(line.credit);
      const balance = DEBIT_NORMAL.has(line.ledgerAccount.type) ? debit.minus(credit) : credit.minus(debit);
      byAccount.set(line.ledgerAccountId, {
        ledgerAccountId: line.ledgerAccountId,
        code: line.ledgerAccount.code,
        name: line.ledgerAccount.name,
        type: line.ledgerAccount.type,
        debit: debit.toString(),
        credit: credit.toString(),
        balance: balance.toString(),
      });
    }
    return [...byAccount.values()].sort((a, b) => a.code.localeCompare(b.code));
  }
}
