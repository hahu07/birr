import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsNumberString, IsOptional, IsString } from "class-validator";
import { prisma } from "@birr/db";
import { CASH_AND_BANK_ACCOUNT_CODE, WaqfLedgerService } from "./waqf-ledger.service";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";

export class CreateWaqfExpenseInput {
  @IsString()
  waqfId!: string;

  @IsOptional()
  @IsString()
  waqfMilestoneId?: string;

  @IsString()
  ledgerAccountId!: string;

  @IsNumberString()
  @IsPositiveDecimal()
  amount!: string;

  @IsString()
  currency!: string;

  @IsString()
  description!: string;
}

/**
 * Founder/Waqf-side counterpart to VaultExpensesService — an itemized
 * project cost (e.g. "Cement — 50 bags," 500, USD) a lump-sum
 * Distribution payout to a Beneficiary can't itemize on its own. Plain
 * staff CRUD to create (only waqf.milestone_complete is governed, not
 * every line-item leading up to it — same precedent as the Vault side);
 * still writes its own audit_logs row and auto-posts a balanced journal
 * entry (Debit the chosen expense account, Credit Cash & Bank).
 * Append-only — no update/delete; a mis-entered expense is corrected
 * with a new offsetting WaqfExpense, never an edit.
 */
@Injectable()
export class WaqfExpensesService {
  constructor(private readonly ledger: WaqfLedgerService) {}

  async create(input: CreateWaqfExpenseInput, actorUserId: string) {
    const waqf = await prisma.waqf.findFirst({ where: { id: input.waqfId, deletedAt: null } });
    if (!waqf) throw new NotFoundException(`Waqf "${input.waqfId}" not found.`);
    // Same currency guard VaultExpensesService.create() carries (found
    // in that same codebase audit): without this, staff could post a
    // balanced journal entry in a currency this waqf never actually
    // raised anything in. Waqfs with no declared corpusCurrency
    // (legacy) fall through unchecked, same posture as
    // DistributionsService.create()'s own currency check.
    if (waqf.corpusCurrency && waqf.corpusCurrency !== input.currency) {
      throw new BadRequestException(`This waqf's corpus is denominated in ${waqf.corpusCurrency} — an expense must use that same currency, not ${input.currency}.`);
    }
    if (input.waqfMilestoneId) {
      const milestone = await prisma.waqfMilestone.findFirst({ where: { id: input.waqfMilestoneId, waqfId: input.waqfId, deletedAt: null } });
      if (!milestone) throw new NotFoundException(`Milestone "${input.waqfMilestoneId}" not found on this waqf.`);
    }
    const expenseAccount = await prisma.waqfLedgerAccount.findFirst({ where: { id: input.ledgerAccountId, deletedAt: null } });
    if (!expenseAccount) throw new NotFoundException(`Ledger account "${input.ledgerAccountId}" not found.`);

    return prisma.$transaction(async (tx) => {
      const expense = await tx.waqfExpense.create({ data: { ...input, recordedByUserId: actorUserId } });

      const cashAndBank = await this.ledger.getAccountByCode(tx, CASH_AND_BANK_ACCOUNT_CODE);
      await this.ledger.post(tx, {
        waqfId: input.waqfId,
        description: input.description,
        currency: input.currency,
        source: "expense",
        sourceId: expense.id,
        actorType: "birr_staff",
        actorUserId,
        lines: [
          { ledgerAccountId: expenseAccount.id, debit: input.amount },
          { ledgerAccountId: cashAndBank.id, credit: input.amount },
        ],
      });

      await tx.auditLog.create({
        data: {
          waqfId: input.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "waqf_expense.created",
          entityType: "WaqfExpense",
          entityId: expense.id,
          after: expense as any,
        },
      });

      return expense;
    });
  }

  list(waqfId: string) {
    return prisma.waqfExpense.findMany({ where: { waqfId }, orderBy: { createdAt: "desc" } });
  }
}
