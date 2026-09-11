import { prisma } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { VaultInvestmentsService } from "./vault-investments.service";
import { VaultsService } from "./vaults.service";
import { VaultProceedsService } from "./vault-proceeds.service";
import { InvestmentsService } from "../investments/investments.service";

describe("VaultInvestmentsService", () => {
  const service = new VaultInvestmentsService();
  const vaultsService = new VaultsService(new VaultProceedsService());
  const investmentsService = new InvestmentsService();

  const vaultIds: string[] = [];
  const vaultInvestmentIds: string[] = [];
  const investmentIds: string[] = [];
  const waqfIds: string[] = [];
  const counterpartyIds: string[] = [];
  let actorUserId: string;
  let investmentVaultId: string;
  let projectVaultId: string;
  let activeCounterpartyId: string;

  beforeAll(async () => {
    const actorUser = await prisma.user.create({
      data: { email: `vault-investments-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "mutawalli_officer" } });

    const investmentVault = await vaultsService.create(
      { name: "Investment Test Vault", slug: `investment-test-${Date.now()}`, type: "investment", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    investmentVaultId = investmentVault.id;
    vaultIds.push(investmentVault.id);

    const projectVault = await vaultsService.create(
      { name: "Project Test Vault", slug: `project-test-${Date.now()}`, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    projectVaultId = projectVault.id;
    vaultIds.push(projectVault.id);

    // A vault can't invest more than it's actually raised — real
    // confirmed VaultContribution needed. Created directly since a real
    // donor/payment flow isn't the point of this fixture.
    const donor = await prisma.vaultDonor.create({ data: { email: `vault-investments-donor-${Date.now()}@example.com` } });
    await prisma.vaultContribution.create({
      data: {
        vaultId: investmentVaultId,
        donorId: donor.id,
        amount: "2000",
        currency: "USD",
        provider: "paystack",
        providerReference: `vault-investments-spec-${randomUUID()}`,
        status: "confirmed",
      },
    });

    const activeCounterparty = await prisma.counterparty.create({
      data: { name: `Vault Investments Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", status: "active" },
    });
    activeCounterpartyId = activeCounterparty.id;
    counterpartyIds.push(activeCounterparty.id);
  });

  afterAll(async () => {
    await prisma.vaultInvestment.deleteMany({ where: { id: { in: vaultInvestmentIds } } });
    await prisma.investment.deleteMany({ where: { id: { in: investmentIds } } });
    await prisma.vaultContribution.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.contribution.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.vaultCause.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.counterparty.deleteMany({ where: { id: { in: counterpartyIds } } });
    await prisma.$disconnect();
  });

  test("create() writes the investment and a matching audit_logs record attributed to the vault, not a waqf", async () => {
    const investment = await service.create(
      { vaultId: investmentVaultId, name: "Fixture Vault Investment", instrumentType: "sukuk", allocatedAmount: "1000", counterpartyId: activeCounterpartyId },
      actorUserId,
    );
    vaultInvestmentIds.push(investment.id);
    expect(investment.currency).toBe("USD");

    const logs = await prisma.auditLog.findMany({ where: { entityId: investment.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, vaultId: investmentVaultId, action: "vault_investment.created" });
  });

  test("create() rejects a project-style vault — only investment-style vaults route pooled contributions into instruments", async () => {
    await expect(
      service.create(
        { vaultId: projectVaultId, name: "Should Fail", instrumentType: "sukuk", allocatedAmount: "100", counterpartyId: activeCounterpartyId },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("create() rejects committing more than the vault's raised amount across its investments", async () => {
    await expect(
      service.create(
        { vaultId: investmentVaultId, name: "Too Much", instrumentType: "sukuk", allocatedAmount: "5000", counterpartyId: activeCounterpartyId },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("a counterparty's concentration limit counts BOTH regular Investment and VaultInvestment exposure combined", async () => {
    const limitedCounterparty = await prisma.counterparty.create({
      data: {
        name: `Vault Investments Concentration Fixture Bank ${randomUUID()}`,
        institutionType: "bank",
        jurisdiction: "AE",
        status: "active",
        concentrationLimit: "1500",
        concentrationLimitCurrency: "USD",
      },
    });
    counterpartyIds.push(limitedCounterparty.id);

    // A real Waqf + Investment placing 1000 of the 1500 limit...
    const foundation = await prisma.foundation.create({ data: { name: "Vault Investments Cross-Check Fixture Foundation" } });
    const waqf = await prisma.waqf.create({
      data: { name: "Vault Investments Cross-Check Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id, corpusCurrency: "USD" },
    });
    waqfIds.push(waqf.id);
    await prisma.contribution.create({
      data: {
        waqfId: waqf.id,
        amount: "5000",
        currency: "USD",
        provider: "paystack",
        providerReference: `vault-investments-waqf-side-${randomUUID()}`,
        status: "confirmed",
      },
    });
    const waqfInvestment = await investmentsService.create(
      { waqfId: waqf.id, name: "Waqf-side Investment", instrumentType: "sukuk", allocatedAmount: "1000", counterpartyId: limitedCounterparty.id },
      actorUserId,
    );
    investmentIds.push(waqfInvestment.id);

    // ...leaves only 500 of the SAME counterparty's limit for the vault
    // side — a VaultInvestment of 1000 should be rejected even though
    // the vault itself has plenty raised.
    await expect(
      service.create(
        { vaultId: investmentVaultId, name: "Should Exceed Combined Limit", instrumentType: "sukuk", allocatedAmount: "1000", counterpartyId: limitedCounterparty.id },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    // But 500 (exactly what's left) succeeds.
    const vaultInvestment = await service.create(
      { vaultId: investmentVaultId, name: "Fits Remaining Limit", instrumentType: "sukuk", allocatedAmount: "500", counterpartyId: limitedCounterparty.id },
      actorUserId,
    );
    vaultInvestmentIds.push(vaultInvestment.id);
  });

  test("changeAllocation() re-checks the within-raised ceiling", async () => {
    const investment = await service.create(
      { vaultId: investmentVaultId, name: "Change Allocation Fixture", instrumentType: "sukuk", allocatedAmount: "100", counterpartyId: activeCounterpartyId },
      actorUserId,
    );
    vaultInvestmentIds.push(investment.id);

    await prisma.$transaction(async (tx) => {
      await expect(service.changeAllocation(investment.id, "999999", tx)).rejects.toThrow(BadRequestException);
    });
  });
});
