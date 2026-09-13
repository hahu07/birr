import { prisma } from "@birr/db";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { VaultLedgerAccountsService } from "./vault-ledger-accounts.service";

describe("VaultLedgerAccountsService", () => {
  const service = new VaultLedgerAccountsService();

  const accountIds: string[] = [];
  let actorUserId: string;

  beforeAll(async () => {
    const actorUser = await prisma.user.create({
      data: { email: `vault-ledger-accounts-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "platform_admin" } });
  });

  afterAll(async () => {
    await prisma.vaultLedgerAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  test("create() writes the account and an audit_logs record", async () => {
    const account = await service.create({ code: `TEST-${Date.now()}`, name: "Test Expense Sub-Account", type: "expense" }, actorUserId);
    accountIds.push(account.id);
    expect(account.isSystemDefault).toBe(false);

    const logs = await prisma.auditLog.findMany({ where: { entityId: account.id, action: "vault_ledger_account.created" } });
    expect(logs).toHaveLength(1);
  });

  test("create() rejects a duplicate code", async () => {
    const code = `TEST-DUP-${Date.now()}`;
    const account = await service.create({ code, name: "First", type: "expense" }, actorUserId);
    accountIds.push(account.id);
    await expect(service.create({ code, name: "Second", type: "expense" }, actorUserId)).rejects.toThrow(ConflictException);
  });

  test("retire() soft-deletes a non-default account, audit-logged", async () => {
    const account = await service.create({ code: `TEST-RETIRE-${Date.now()}`, name: "Retire Me", type: "expense" }, actorUserId);
    accountIds.push(account.id);

    const retired = await service.retire(account.id, actorUserId);
    expect(retired.deletedAt).not.toBeNull();

    const logs = await prisma.auditLog.findMany({ where: { entityId: account.id, action: "vault_ledger_account.retired" } });
    expect(logs).toHaveLength(1);

    expect((await service.list()).find((a) => a.id === account.id)).toBeUndefined();
  });

  test("retire() refuses a system-default account", async () => {
    const cashAndBank = await prisma.vaultLedgerAccount.findFirstOrThrow({ where: { code: "1000" } });
    await expect(service.retire(cashAndBank.id, actorUserId)).rejects.toThrow(BadRequestException);
  });

  test("retire() throws NotFoundException for an unknown id", async () => {
    await expect(service.retire("00000000-0000-0000-0000-000000000000", actorUserId)).rejects.toThrow(NotFoundException);
  });

  test("list() excludes retired accounts and is sorted by code", async () => {
    const accounts = await service.list();
    const codes = accounts.map((a) => a.code);
    expect(codes).toEqual([...codes].sort());
    expect(codes).toContain("1000");
  });
});
