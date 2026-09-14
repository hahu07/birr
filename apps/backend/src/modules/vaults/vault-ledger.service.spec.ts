import { prisma } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { VaultLedgerService, CASH_AND_BANK_ACCOUNT_CODE, DONATIONS_REVENUE_ACCOUNT_CODE, PROGRAM_EXPENSES_ACCOUNT_CODE } from "./vault-ledger.service";
import { VaultsService } from "./vaults.service";
import { VaultProceedsService } from "./vault-proceeds.service";

describe("VaultLedgerService", () => {
  const service = new VaultLedgerService();
  const vaultsService = new VaultsService(new VaultProceedsService(), service);

  const vaultIds: string[] = [];
  let actorUserId: string;
  let vaultId: string;
  let cashAndBankId: string;
  let donationsRevenueId: string;
  let programExpensesId: string;

  beforeAll(async () => {
    const actorUser = await prisma.user.create({
      data: { email: `vault-ledger-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "mutawalli_officer" } });

    const vault = await vaultsService.create(
      { name: "Ledger Test Vault", slug: `ledger-test-${Date.now()}`, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultId = vault.id;
    vaultIds.push(vault.id);

    // These four are seeded by prisma/seed.ts — confirmed present here
    // rather than assumed, so a spec run against an unseeded DB fails
    // clearly instead of a confusing NotFoundException deep in post().
    cashAndBankId = (await prisma.vaultLedgerAccount.findFirstOrThrow({ where: { code: CASH_AND_BANK_ACCOUNT_CODE } })).id;
    donationsRevenueId = (await prisma.vaultLedgerAccount.findFirstOrThrow({ where: { code: DONATIONS_REVENUE_ACCOUNT_CODE } })).id;
    programExpensesId = (await prisma.vaultLedgerAccount.findFirstOrThrow({ where: { code: PROGRAM_EXPENSES_ACCOUNT_CODE } })).id;
  });

  afterAll(async () => {
    await prisma.vaultJournalEntryLine.deleteMany({ where: { journalEntry: { vaultId: { in: vaultIds } } } });
    await prisma.vaultJournalEntry.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.$disconnect();
  });

  test("post() writes a balanced entry with its lines", async () => {
    const entry = await prisma.$transaction((tx) =>
      service.post(tx, {
        vaultId,
        description: "Test contribution",
        currency: "USD",
        source: "contribution",
        actorType: "system",
        lines: [
          { ledgerAccountId: cashAndBankId, debit: "100" },
          { ledgerAccountId: donationsRevenueId, credit: "100" },
        ],
      }),
    );
    expect(entry.lines).toHaveLength(2);
    expect(entry.lines.find((l) => l.ledgerAccountId === cashAndBankId)?.debit.toString()).toBe("100");
    expect(entry.lines.find((l) => l.ledgerAccountId === donationsRevenueId)?.credit.toString()).toBe("100");
  });

  test("post() rejects an unbalanced entry (debits != credits)", async () => {
    await expect(
      prisma.$transaction((tx) =>
        service.post(tx, {
          vaultId,
          description: "Unbalanced",
          currency: "USD",
          source: "manual_adjustment",
          actorType: "system",
          lines: [
            { ledgerAccountId: cashAndBankId, debit: "100" },
            { ledgerAccountId: donationsRevenueId, credit: "99" },
          ],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("post() rejects a line that is both a debit and a credit, or neither", async () => {
    await expect(
      prisma.$transaction((tx) =>
        service.post(tx, {
          vaultId,
          description: "Both set",
          currency: "USD",
          source: "manual_adjustment",
          actorType: "system",
          lines: [
            { ledgerAccountId: cashAndBankId, debit: "50", credit: "50" },
            { ledgerAccountId: donationsRevenueId, credit: "50" },
          ],
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      prisma.$transaction((tx) =>
        service.post(tx, {
          vaultId,
          description: "Neither set",
          currency: "USD",
          source: "manual_adjustment",
          actorType: "system",
          lines: [
            { ledgerAccountId: cashAndBankId },
            { ledgerAccountId: donationsRevenueId, credit: "50" },
          ],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("trialBalance() and incomeStatement() reflect posted entries, scoped by currency", async () => {
    const otherVault = await vaultsService.create(
      { name: "Ledger Test Vault Two", slug: `ledger-test-two-${Date.now()}`, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(otherVault.id);

    await prisma.$transaction((tx) =>
      service.post(tx, {
        vaultId: otherVault.id,
        description: "Contribution",
        currency: "USD",
        source: "contribution",
        actorType: "system",
        lines: [
          { ledgerAccountId: cashAndBankId, debit: "300" },
          { ledgerAccountId: donationsRevenueId, credit: "300" },
        ],
      }),
    );
    await prisma.$transaction((tx) =>
      service.post(tx, {
        vaultId: otherVault.id,
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

    const trialBalance = await service.trialBalance(otherVault.id, "USD");
    const cash = trialBalance.find((a) => a.ledgerAccountId === cashAndBankId);
    const revenue = trialBalance.find((a) => a.ledgerAccountId === donationsRevenueId);
    const expense = trialBalance.find((a) => a.ledgerAccountId === programExpensesId);
    // Cash & Bank is debit-normal (asset): +300 debit, -120 credit = 180.
    expect(cash?.balance).toBe("180");
    // Donations Revenue is credit-normal: 300 credit, 0 debit = 300.
    expect(revenue?.balance).toBe("300");
    // Program Expenses is debit-normal: 120 debit, 0 credit = 120.
    expect(expense?.balance).toBe("120");

    const incomeStatement = await service.incomeStatement(otherVault.id, "USD");
    expect(incomeStatement.map((a) => a.ledgerAccountId).sort()).toEqual([donationsRevenueId, programExpensesId].sort());

    // A currency this vault never transacted in reports nothing —
    // never a fabricated zero row for every account in existence.
    expect(await service.trialBalance(otherVault.id, "NGN")).toEqual([]);
  });

  test("spentByCurrency() reports the Program Expenses account's own balance, per currency, for the public 'raised vs. spent' comparison", async () => {
    const spendVault = await vaultsService.create(
      { name: "Ledger Spend Test Vault", slug: `ledger-spend-test-${Date.now()}`, type: "project", currency: "USD", jurisdiction: "NG", additionalCurrencies: ["NGN"] },
      actorUserId,
    );
    vaultIds.push(spendVault.id);

    expect(await service.spentByCurrency(spendVault.id)).toEqual([]);

    await prisma.$transaction((tx) =>
      service.post(tx, {
        vaultId: spendVault.id,
        description: "Expense — USD",
        currency: "USD",
        source: "expense",
        actorType: "system",
        lines: [
          { ledgerAccountId: programExpensesId, debit: "250" },
          { ledgerAccountId: cashAndBankId, credit: "250" },
        ],
      }),
    );
    await prisma.$transaction((tx) =>
      service.post(tx, {
        vaultId: spendVault.id,
        description: "Expense — NGN",
        currency: "NGN",
        source: "expense",
        actorType: "system",
        lines: [
          { ledgerAccountId: programExpensesId, debit: "50000" },
          { ledgerAccountId: cashAndBankId, credit: "50000" },
        ],
      }),
    );

    const spent = await service.spentByCurrency(spendVault.id);
    expect(spent).toEqual(
      expect.arrayContaining([
        { currency: "USD", amount: "250" },
        { currency: "NGN", amount: "50000" },
      ]),
    );
    expect(spent).toHaveLength(2);
  });
});
