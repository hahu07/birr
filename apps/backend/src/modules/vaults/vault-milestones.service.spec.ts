import { prisma } from "@birr/db";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { VaultMilestonesService } from "./vault-milestones.service";
import { VaultsService } from "./vaults.service";
import { VaultProceedsService } from "./vault-proceeds.service";

describe("VaultMilestonesService", () => {
  const service = new VaultMilestonesService();
  const vaultsService = new VaultsService(new VaultProceedsService());

  const vaultIds: string[] = [];
  let actorUserId: string;
  let projectVaultId: string;
  let investmentVaultId: string;

  beforeAll(async () => {
    const actorUser = await prisma.user.create({
      data: { email: `vault-milestones-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "mutawalli_officer" } });

    const projectVault = await vaultsService.create(
      { name: "Milestones Test Vault", slug: `milestones-test-${Date.now()}`, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    projectVaultId = projectVault.id;
    vaultIds.push(projectVault.id);

    const investmentVault = await vaultsService.create(
      { name: "Milestones Investment Vault", slug: `milestones-investment-${Date.now()}`, type: "investment", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    investmentVaultId = investmentVault.id;
    vaultIds.push(investmentVault.id);
  });

  afterAll(async () => {
    await prisma.vaultMilestone.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.$disconnect();
  });

  test("create() writes the milestone and an audit_logs record", async () => {
    const milestone = await service.create(
      { vaultId: projectVaultId, name: "Site survey & permits", sequence: 1, targetAmount: "1000" },
      actorUserId,
    );
    expect(milestone.status).toBe("pending");

    const logs = await prisma.auditLog.findMany({ where: { entityId: milestone.id, action: "vault_milestone.created" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, vaultId: projectVaultId });
  });

  test("create() rejects a milestone against an investment-type vault", async () => {
    await expect(
      service.create({ vaultId: investmentVaultId, name: "Not applicable", sequence: 1 }, actorUserId),
    ).rejects.toThrow(BadRequestException);
  });

  test("create() rejects a duplicate sequence on the same vault", async () => {
    await service.create({ vaultId: projectVaultId, name: "Foundation laid", sequence: 2 }, actorUserId);
    await expect(
      service.create({ vaultId: projectVaultId, name: "Duplicate sequence", sequence: 2 }, actorUserId),
    ).rejects.toThrow(ConflictException);
  });

  test("create() throws NotFoundException for an unknown vaultId", async () => {
    await expect(
      service.create({ vaultId: "00000000-0000-0000-0000-000000000000", name: "Ghost milestone", sequence: 1 }, actorUserId),
    ).rejects.toThrow(NotFoundException);
  });

  test("list() returns a vault's milestones ordered by sequence", async () => {
    const milestones = await service.list(projectVaultId);
    expect(milestones.map((m) => m.sequence)).toEqual([1, 2]);
  });

  describe("complete()", () => {
    test("sets status to completed and completedAt", async () => {
      const milestone = await service.create({ vaultId: projectVaultId, name: "Well drilled", sequence: 3 }, actorUserId);
      const completed = await prisma.$transaction((tx) => service.complete(milestone.id, tx));
      expect(completed.status).toBe("completed");
      expect(completed.completedAt).not.toBeNull();
    });

    test("rejects a milestone that's already completed", async () => {
      const milestone = await service.create({ vaultId: projectVaultId, name: "Pump installed", sequence: 4 }, actorUserId);
      await prisma.$transaction((tx) => service.complete(milestone.id, tx));
      await expect(prisma.$transaction((tx) => service.complete(milestone.id, tx))).rejects.toThrow(BadRequestException);
    });

    test("throws NotFoundException for an unknown milestone id", async () => {
      await expect(
        prisma.$transaction((tx) => service.complete("00000000-0000-0000-0000-000000000000", tx)),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
