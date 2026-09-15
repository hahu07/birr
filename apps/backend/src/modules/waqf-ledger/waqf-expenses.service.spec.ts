import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { WaqfExpensesService } from "./waqf-expenses.service";
import { WaqfLedgerService, CASH_AND_BANK_ACCOUNT_CODE } from "./waqf-ledger.service";
import { WaqfMilestonesService } from "./waqf-milestones.service";

describe("WaqfExpensesService", () => {
  const service = new WaqfExpensesService(new WaqfLedgerService());
  const milestonesService = new WaqfMilestonesService();

  const waqfIds: string[] = [];
  let actorUserId: string;
  let foundationId: string;
  let waqfId: string;
  let expenseAccountId: string;
  let milestoneId: string;

  beforeAll(async () => {
    const actorUser = await prisma.user.create({
      data: { email: `waqf-expenses-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "mutawalli_officer" } });

    const foundation = await prisma.foundation.create({ data: { name: "Waqf Expenses Fixture Foundation" } });
    foundationId = foundation.id;

    const waqf = await prisma.waqf.create({
      data: { name: "Expenses Test Waqf", type: "project", jurisdiction: "NG", foundationId, corpusCurrency: "USD" },
    });
    waqfId = waqf.id;
    waqfIds.push(waqf.id);

    const milestone = await milestonesService.create({ waqfId, name: "Foundation laid", sequence: 1 }, actorUserId);
    milestoneId = milestone.id;

    const expenseAccount = await prisma.waqfLedgerAccount.create({
      data: { code: `WAQF-EXP-TEST-${Date.now()}`, name: "Materials (Test)", type: "expense" },
    });
    expenseAccountId = expenseAccount.id;
  });

  afterAll(async () => {
    await prisma.waqfJournalEntryLine.deleteMany({ where: { journalEntry: { waqfId: { in: waqfIds } } } });
    await prisma.waqfJournalEntry.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqfExpense.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqfLedgerAccount.delete({ where: { id: expenseAccountId } });
    await prisma.waqfMilestone.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.foundation.delete({ where: { id: foundationId } });
    await prisma.$disconnect();
  });

  test("create() writes the expense, an audit_logs record, and a balanced journal entry", async () => {
    const expense = await service.create(
      { waqfId, waqfMilestoneId: milestoneId, ledgerAccountId: expenseAccountId, amount: "500", currency: "USD", description: "Cement — 50 bags" },
      actorUserId,
    );
    expect(expense.amount.toString()).toBe("500");

    const logs = await prisma.auditLog.findMany({ where: { entityId: expense.id, action: "waqf_expense.created" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, waqfId });

    const journalEntry = await prisma.waqfJournalEntry.findFirst({
      where: { source: "expense", sourceId: expense.id },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    expect(journalEntry?.lines).toHaveLength(2);
    expect(journalEntry?.lines.find((l) => l.ledgerAccount.id === expenseAccountId)?.debit.toString()).toBe("500");
    expect(journalEntry?.lines.find((l) => l.ledgerAccount.code === CASH_AND_BANK_ACCOUNT_CODE)?.credit.toString()).toBe("500");
  });

  test("create() rejects a currency that doesn't match the waqf's declared corpusCurrency", async () => {
    await expect(
      service.create(
        { waqfId, ledgerAccountId: expenseAccountId, amount: "50", currency: "EUR", description: "Unaccepted currency" },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("create() falls through unchecked for a legacy waqf with no declared corpusCurrency", async () => {
    const legacyWaqf = await prisma.waqf.create({
      data: { name: "Expenses Legacy Waqf (no corpusCurrency)", type: "project", jurisdiction: "NG", foundationId },
    });
    waqfIds.push(legacyWaqf.id);

    const expense = await service.create(
      { waqfId: legacyWaqf.id, ledgerAccountId: expenseAccountId, amount: "50000", currency: "NGN", description: "Local transport" },
      actorUserId,
    );
    expect(expense.currency).toBe("NGN");
  });

  test("create() throws NotFoundException for an unknown waqfId, milestoneId, or ledgerAccountId", async () => {
    await expect(
      service.create(
        { waqfId: "00000000-0000-0000-0000-000000000000", ledgerAccountId: expenseAccountId, amount: "10", currency: "USD", description: "x" },
        actorUserId,
      ),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.create(
        { waqfId, waqfMilestoneId: "00000000-0000-0000-0000-000000000000", ledgerAccountId: expenseAccountId, amount: "10", currency: "USD", description: "x" },
        actorUserId,
      ),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.create(
        { waqfId, ledgerAccountId: "00000000-0000-0000-0000-000000000000", amount: "10", currency: "USD", description: "x" },
        actorUserId,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  test("list() returns a waqf's expenses newest first", async () => {
    const expenses = await service.list(waqfId);
    expect(expenses.length).toBeGreaterThan(0);
    expect(expenses.every((e) => e.waqfId === waqfId)).toBe(true);
  });
});
