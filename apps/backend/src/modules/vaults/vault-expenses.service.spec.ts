import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { VaultExpensesService } from "./vault-expenses.service";
import { VaultLedgerService, CASH_AND_BANK_ACCOUNT_CODE } from "./vault-ledger.service";
import { VaultMilestonesService } from "./vault-milestones.service";
import { VaultsService } from "./vaults.service";
import { VaultProceedsService } from "./vault-proceeds.service";

describe("VaultExpensesService", () => {
  const service = new VaultExpensesService(new VaultLedgerService());
  const vaultsService = new VaultsService(new VaultProceedsService(), new VaultLedgerService());
  const milestonesService = new VaultMilestonesService();

  const vaultIds: string[] = [];
  let actorUserId: string;
  let vaultId: string;
  let expenseAccountId: string;
  let milestoneId: string;

  beforeAll(async () => {
    const actorUser = await prisma.user.create({
      data: { email: `vault-expenses-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "mutawalli_officer" } });

    const vault = await vaultsService.create(
      { name: "Expenses Test Vault", slug: `expenses-test-${Date.now()}`, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultId = vault.id;
    vaultIds.push(vault.id);

    const milestone = await milestonesService.create({ vaultId, name: "Foundation laid", sequence: 1 }, actorUserId);
    milestoneId = milestone.id;

    const expenseAccount = await prisma.vaultLedgerAccount.create({
      data: { code: `EXP-TEST-${Date.now()}`, name: "Materials (Test)", type: "expense" },
    });
    expenseAccountId = expenseAccount.id;
  });

  afterAll(async () => {
    await prisma.vaultJournalEntryLine.deleteMany({ where: { journalEntry: { vaultId: { in: vaultIds } } } });
    await prisma.vaultJournalEntry.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vaultExpense.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vaultLedgerAccount.delete({ where: { id: expenseAccountId } });
    await prisma.vaultMilestone.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.$disconnect();
  });

  test("create() writes the expense, an audit_logs record, and a balanced journal entry", async () => {
    const expense = await service.create(
      { vaultId, vaultMilestoneId: milestoneId, ledgerAccountId: expenseAccountId, amount: "500", currency: "USD", description: "Cement — 50 bags" },
      actorUserId,
    );
    expect(expense.amount.toString()).toBe("500");

    const logs = await prisma.auditLog.findMany({ where: { entityId: expense.id, action: "vault_expense.created" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, vaultId });

    const journalEntry = await prisma.vaultJournalEntry.findFirst({
      where: { source: "expense", sourceId: expense.id },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    expect(journalEntry?.lines).toHaveLength(2);
    expect(journalEntry?.lines.find((l) => l.ledgerAccount.id === expenseAccountId)?.debit.toString()).toBe("500");
    expect(journalEntry?.lines.find((l) => l.ledgerAccount.code === CASH_AND_BANK_ACCOUNT_CODE)?.credit.toString()).toBe("500");
  });

  test("create() rejects a currency the vault doesn't accept, and accepts one of its additionalCurrencies", async () => {
    await expect(
      service.create(
        { vaultId, ledgerAccountId: expenseAccountId, amount: "50", currency: "EUR", description: "Unaccepted currency" },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    const multiCurrencyVault = await vaultsService.create(
      {
        name: "Expenses Multi Currency Vault",
        slug: `expenses-multi-currency-${Date.now()}`,
        type: "project",
        currency: "USD",
        jurisdiction: "NG",
        additionalCurrencies: ["NGN"],
      },
      actorUserId,
    );
    vaultIds.push(multiCurrencyVault.id);

    const expense = await service.create(
      { vaultId: multiCurrencyVault.id, ledgerAccountId: expenseAccountId, amount: "50000", currency: "NGN", description: "Local transport" },
      actorUserId,
    );
    expect(expense.currency).toBe("NGN");
  });

  test("create() throws NotFoundException for an unknown vaultId, milestoneId, or ledgerAccountId", async () => {
    await expect(
      service.create(
        { vaultId: "00000000-0000-0000-0000-000000000000", ledgerAccountId: expenseAccountId, amount: "10", currency: "USD", description: "x" },
        actorUserId,
      ),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.create(
        { vaultId, vaultMilestoneId: "00000000-0000-0000-0000-000000000000", ledgerAccountId: expenseAccountId, amount: "10", currency: "USD", description: "x" },
        actorUserId,
      ),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.create(
        { vaultId, ledgerAccountId: "00000000-0000-0000-0000-000000000000", amount: "10", currency: "USD", description: "x" },
        actorUserId,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  test("list() returns a vault's expenses newest first", async () => {
    const expenses = await service.list(vaultId);
    expect(expenses.length).toBeGreaterThan(0);
    expect(expenses.every((e) => e.vaultId === vaultId)).toBe(true);
  });
});
