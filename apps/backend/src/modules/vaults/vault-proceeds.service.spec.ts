import { prisma } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { VaultProceedsService } from "./vault-proceeds.service";
import { VaultsService } from "./vaults.service";
import { VaultLedgerService } from "./vault-ledger.service";

describe("VaultProceedsService", () => {
  const service = new VaultProceedsService();
  const vaultsService = new VaultsService(service, new VaultLedgerService());

  const vaultIds: string[] = [];
  let actorUserId: string;
  let investmentVaultId: string;
  let projectVaultId: string;

  beforeAll(async () => {
    const actorUser = await prisma.user.create({
      data: { email: `vault-proceeds-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "mutawalli_officer" } });

    const investmentVault = await vaultsService.create(
      {
        name: "Proceeds Test Vault",
        slug: `proceeds-test-${Date.now()}`,
        type: "investment",
        currency: "USD",
        additionalCurrencies: ["NGN"],
        jurisdiction: "NG",
      },
      actorUserId,
    );
    investmentVaultId = investmentVault.id;
    vaultIds.push(investmentVault.id);

    const projectVault = await vaultsService.create(
      { name: "Proceeds Reject Test Vault", slug: `proceeds-reject-test-${Date.now()}`, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    projectVaultId = projectVault.id;
    vaultIds.push(projectVault.id);
  });

  afterAll(async () => {
    await prisma.vaultProceeds.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.$disconnect();
  });

  test("record() writes the proceeds row and a matching audit_logs record", async () => {
    const proceeds = await service.record(
      { vaultId: investmentVaultId, amount: "500", currency: "USD", description: "Q1 return" },
      actorUserId,
    );
    const logs = await prisma.auditLog.findMany({ where: { entityId: proceeds.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, vaultId: investmentVaultId, action: "vault_proceeds.recorded" });
  });

  test("record() rejects a project-style vault — only investment-style vaults have proceeds", async () => {
    await expect(
      service.record({ vaultId: projectVaultId, amount: "100", currency: "USD", description: "Should fail" }, actorUserId),
    ).rejects.toThrow(BadRequestException);
  });

  test("sumForVault() sums every recorded proceeds row for that vault in the given currency", async () => {
    await service.record({ vaultId: investmentVaultId, amount: "250", currency: "USD", description: "Q2 return" }, actorUserId);
    const sum = await service.sumForVault(investmentVaultId, "USD");
    expect(sum.toString()).toBe("750");
  });

  test("sumForVault() doesn't mix currencies — NGN proceeds are invisible to a USD sum and vice versa", async () => {
    await service.record({ vaultId: investmentVaultId, amount: "100000", currency: "NGN", description: "NGN return" }, actorUserId);
    const usdSum = await service.sumForVault(investmentVaultId, "USD");
    const ngnSum = await service.sumForVault(investmentVaultId, "NGN");
    expect(usdSum.toString()).toBe("750");
    expect(ngnSum.toString()).toBe("100000");
  });

  test("record() rejects a currency the vault doesn't accept", async () => {
    await expect(
      service.record({ vaultId: investmentVaultId, amount: "50", currency: "EUR", description: "Untracked currency" }, actorUserId),
    ).rejects.toThrow(BadRequestException);
  });
});
