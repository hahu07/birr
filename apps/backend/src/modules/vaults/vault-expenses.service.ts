import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsNumberString, IsOptional, IsString } from "class-validator";
import { prisma } from "@birr/db";
import { CASH_AND_BANK_ACCOUNT_CODE, VaultLedgerService } from "./vault-ledger.service";
import { findVaultOrThrow } from "./find-vault-or-throw";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";

export class CreateVaultExpenseInput {
  @IsString()
  vaultId!: string;

  @IsOptional()
  @IsString()
  vaultMilestoneId?: string;

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
 * An itemized project cost (e.g. "Cement — 50 bags," 500, USD) — the
 * thing a lump-sum VaultDistribution payout to a Counterparty can't
 * itemize on its own. Plain staff CRUD to create (mirrors
 * VaultDistributionsService.create()'s own precedent — only
 * vault.distribution_approve is governed, not every line-item leading
 * up to it); still writes its own audit_logs row and auto-posts a
 * balanced journal entry (Debit the chosen expense account, Credit
 * Cash & Bank), same as every other Vault mutation. Append-only, like
 * VaultJournalEntry — no update/delete here; a mis-entered expense is
 * corrected with a new offsetting VaultExpense, never an edit.
 */
@Injectable()
export class VaultExpensesService {
  constructor(private readonly ledger: VaultLedgerService) {}

  async create(input: CreateVaultExpenseInput, actorUserId: string) {
    const vault = await findVaultOrThrow(prisma, input.vaultId);
    // Found in a codebase audit: unlike VaultContributionsService.initiate(),
    // this had no check at all against the vault's accepted currencies —
    // staff could silently post a balanced journal entry in a currency
    // the vault never actually raised anything in, corrupting that
    // currency's books with money that was never real.
    const acceptedCurrencies = [vault.currency, ...vault.additionalCurrencies];
    if (!acceptedCurrencies.includes(input.currency)) {
      throw new BadRequestException(`This vault only accepts amounts in ${acceptedCurrencies.join(", ")}.`);
    }
    if (input.vaultMilestoneId) {
      const milestone = await prisma.vaultMilestone.findFirst({ where: { id: input.vaultMilestoneId, vaultId: input.vaultId, deletedAt: null } });
      if (!milestone) throw new NotFoundException(`Milestone "${input.vaultMilestoneId}" not found on this vault.`);
    }
    const expenseAccount = await prisma.vaultLedgerAccount.findFirst({ where: { id: input.ledgerAccountId, deletedAt: null } });
    if (!expenseAccount) throw new NotFoundException(`Ledger account "${input.ledgerAccountId}" not found.`);

    return prisma.$transaction(async (tx) => {
      const expense = await tx.vaultExpense.create({ data: { ...input, recordedByUserId: actorUserId } });

      const cashAndBank = await this.ledger.getAccountByCode(tx, CASH_AND_BANK_ACCOUNT_CODE);
      await this.ledger.post(tx, {
        vaultId: input.vaultId,
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
          vaultId: input.vaultId,
          actorType: "birr_staff",
          actorUserId,
          action: "vault_expense.created",
          entityType: "VaultExpense",
          entityId: expense.id,
          after: expense as any,
        },
      });

      return expense;
    });
  }

  list(vaultId: string) {
    return prisma.vaultExpense.findMany({ where: { vaultId }, orderBy: { createdAt: "desc" } });
  }
}
