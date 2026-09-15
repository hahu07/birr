import { prisma } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { WaqfLedgerService, CASH_AND_BANK_ACCOUNT_CODE, CONTRIBUTIONS_REVENUE_ACCOUNT_CODE, PROGRAM_EXPENSES_ACCOUNT_CODE } from "./waqf-ledger.service";

describe("WaqfLedgerService", () => {
  const service = new WaqfLedgerService();

  const waqfIds: string[] = [];
  const ledgerAccountIds: string[] = [];
  let foundationId: string;
  let waqfId: string;
  let cashAndBankId: string;
  let contributionsRevenueId: string;
  let programExpensesId: string;

  beforeAll(async () => {
    const foundation = await prisma.foundation.create({ data: { name: "Waqf Ledger Fixture Foundation" } });
    foundationId = foundation.id;

    const waqf = await prisma.waqf.create({
      data: { name: "Ledger Test Waqf", type: "project", jurisdiction: "NG", foundationId },
    });
    waqfId = waqf.id;
    waqfIds.push(waqf.id);

    // These four are seeded by prisma/seed.ts — confirmed present here
    // rather than assumed, so a spec run against an unseeded DB fails
    // clearly instead of a confusing NotFoundException deep in post().
    cashAndBankId = (await prisma.waqfLedgerAccount.findFirstOrThrow({ where: { code: CASH_AND_BANK_ACCOUNT_CODE } })).id;
    contributionsRevenueId = (await prisma.waqfLedgerAccount.findFirstOrThrow({ where: { code: CONTRIBUTIONS_REVENUE_ACCOUNT_CODE } })).id;
    programExpensesId = (await prisma.waqfLedgerAccount.findFirstOrThrow({ where: { code: PROGRAM_EXPENSES_ACCOUNT_CODE } })).id;
  });

  afterAll(async () => {
    await prisma.waqfJournalEntryLine.deleteMany({ where: { journalEntry: { waqfId: { in: waqfIds } } } });
    await prisma.waqfJournalEntry.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.foundation.deleteMany({ where: { id: foundationId } });
    await prisma.waqfLedgerAccount.deleteMany({ where: { id: { in: ledgerAccountIds } } });
    await prisma.$disconnect();
  });

  test("post() writes a balanced entry with its lines", async () => {
    const entry = await prisma.$transaction((tx) =>
      service.post(tx, {
        waqfId,
        description: "Test contribution",
        currency: "USD",
        source: "contribution",
        actorType: "system",
        lines: [
          { ledgerAccountId: cashAndBankId, debit: "100" },
          { ledgerAccountId: contributionsRevenueId, credit: "100" },
        ],
      }),
    );
    expect(entry.lines).toHaveLength(2);
    expect(entry.lines.find((l) => l.ledgerAccountId === cashAndBankId)?.debit.toString()).toBe("100");
    expect(entry.lines.find((l) => l.ledgerAccountId === contributionsRevenueId)?.credit.toString()).toBe("100");
  });

  test("post() rejects an unbalanced entry (debits != credits)", async () => {
    await expect(
      prisma.$transaction((tx) =>
        service.post(tx, {
          waqfId,
          description: "Unbalanced",
          currency: "USD",
          source: "manual_adjustment",
          actorType: "system",
          lines: [
            { ledgerAccountId: cashAndBankId, debit: "100" },
            { ledgerAccountId: contributionsRevenueId, credit: "99" },
          ],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("post() rejects a line that is both a debit and a credit, or neither", async () => {
    await expect(
      prisma.$transaction((tx) =>
        service.post(tx, {
          waqfId,
          description: "Both set",
          currency: "USD",
          source: "manual_adjustment",
          actorType: "system",
          lines: [
            { ledgerAccountId: cashAndBankId, debit: "50", credit: "50" },
            { ledgerAccountId: contributionsRevenueId, credit: "50" },
          ],
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      prisma.$transaction((tx) =>
        service.post(tx, {
          waqfId,
          description: "Neither set",
          currency: "USD",
          source: "manual_adjustment",
          actorType: "system",
          lines: [{ ledgerAccountId: cashAndBankId }, { ledgerAccountId: contributionsRevenueId, credit: "50" }],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("trialBalance() and incomeStatement() reflect posted entries, scoped by currency", async () => {
    const otherWaqf = await prisma.waqf.create({
      data: { name: "Ledger Test Waqf Two", type: "project", jurisdiction: "NG", foundationId },
    });
    waqfIds.push(otherWaqf.id);

    await prisma.$transaction((tx) =>
      service.post(tx, {
        waqfId: otherWaqf.id,
        description: "Contribution",
        currency: "USD",
        source: "contribution",
        actorType: "system",
        lines: [
          { ledgerAccountId: cashAndBankId, debit: "300" },
          { ledgerAccountId: contributionsRevenueId, credit: "300" },
        ],
      }),
    );
    await prisma.$transaction((tx) =>
      service.post(tx, {
        waqfId: otherWaqf.id,
        description: "Distribution paid",
        currency: "USD",
        source: "distribution",
        actorType: "system",
        lines: [
          { ledgerAccountId: programExpensesId, debit: "120" },
          { ledgerAccountId: cashAndBankId, credit: "120" },
        ],
      }),
    );

    const trialBalance = await service.trialBalance(otherWaqf.id, "USD");
    const cash = trialBalance.find((a) => a.ledgerAccountId === cashAndBankId);
    const revenue = trialBalance.find((a) => a.ledgerAccountId === contributionsRevenueId);
    const expense = trialBalance.find((a) => a.ledgerAccountId === programExpensesId);
    // Cash & Bank is debit-normal (asset): +300 debit, -120 credit = 180.
    expect(cash?.balance).toBe("180");
    // Contributions Revenue is credit-normal: 300 credit, 0 debit = 300.
    expect(revenue?.balance).toBe("300");
    // Program Expenses is debit-normal: 120 debit, 0 credit = 120.
    expect(expense?.balance).toBe("120");

    const incomeStatement = await service.incomeStatement(otherWaqf.id, "USD");
    expect(incomeStatement.map((a) => a.ledgerAccountId).sort()).toEqual([contributionsRevenueId, programExpensesId].sort());

    // A currency this waqf never transacted in reports nothing — never a
    // fabricated zero row for every account in existence.
    expect(await service.trialBalance(otherWaqf.id, "NGN")).toEqual([]);
  });

  test("spentByCurrency() sums every expense-type account, not just the system-default Program Expenses row", async () => {
    const spendWaqf = await prisma.waqf.create({
      data: { name: "Ledger Sub-Account Spend Test Waqf", type: "project", jurisdiction: "NG", foundationId },
    });
    waqfIds.push(spendWaqf.id);

    const materialsAccount = await prisma.waqfLedgerAccount.create({
      data: { code: `WAQF-EXP-SUB-TEST-${Date.now()}`, name: "Materials (Sub-Account Test)", type: "expense" },
    });
    ledgerAccountIds.push(materialsAccount.id);

    await prisma.$transaction((tx) =>
      service.post(tx, {
        waqfId: spendWaqf.id,
        description: "Materials expense — not the Program Expenses account",
        currency: "USD",
        source: "expense",
        actorType: "system",
        lines: [
          { ledgerAccountId: materialsAccount.id, debit: "600" },
          { ledgerAccountId: cashAndBankId, credit: "600" },
        ],
      }),
    );
    await prisma.$transaction((tx) =>
      service.post(tx, {
        waqfId: spendWaqf.id,
        description: "Distribution paid",
        currency: "USD",
        source: "distribution",
        actorType: "system",
        lines: [
          { ledgerAccountId: programExpensesId, debit: "150" },
          { ledgerAccountId: cashAndBankId, credit: "150" },
        ],
      }),
    );

    expect(await service.spentByCurrency(spendWaqf.id)).toEqual([{ currency: "USD", amount: "750" }]);
  });
});
