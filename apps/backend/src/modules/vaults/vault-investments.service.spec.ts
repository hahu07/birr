import { prisma } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { VaultInvestmentsService } from "./vault-investments.service";
import { VaultsService } from "./vaults.service";
import { VaultProceedsService } from "./vault-proceeds.service";
import { VaultLedgerService } from "./vault-ledger.service";
import { InvestmentsService } from "../investments/investments.service";

describe("VaultInvestmentsService", () => {
  const service = new VaultInvestmentsService();
  const vaultsService = new VaultsService(new VaultProceedsService(), new VaultLedgerService());
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
    // RESTRICT on {vault,}investmentId, must go before Investment/
    // VaultInvestment themselves.
    await prisma.vaultShariahScreening.deleteMany({ where: { vaultInvestmentId: { in: vaultInvestmentIds } } });
    await prisma.shariahScreening.deleteMany({ where: { investmentId: { in: investmentIds } } });
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
      { vaultId: investmentVaultId, name: "Fixture Vault Investment", instrumentType: "sukuk", allocatedAmount: "1000", counterpartyId: activeCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
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
        { vaultId: projectVaultId, name: "Should Fail", instrumentType: "sukuk", allocatedAmount: "100", counterpartyId: activeCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("create() rejects committing more than the vault's raised amount across its investments", async () => {
    await expect(
      service.create(
        { vaultId: investmentVaultId, name: "Too Much", instrumentType: "sukuk", allocatedAmount: "5000", counterpartyId: activeCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
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
      { waqfId: waqf.id, name: "Waqf-side Investment", instrumentType: "sukuk", allocatedAmount: "1000", counterpartyId: limitedCounterparty.id, businessDescription: "Fixture business description for Shariah screening purposes." },
      actorUserId,
    );
    investmentIds.push(waqfInvestment.id);

    // ...leaves only 500 of the SAME counterparty's limit for the vault
    // side — a VaultInvestment of 1000 should be rejected even though
    // the vault itself has plenty raised.
    await expect(
      service.create(
        { vaultId: investmentVaultId, name: "Should Exceed Combined Limit", instrumentType: "sukuk", allocatedAmount: "1000", counterpartyId: limitedCounterparty.id, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    // But 500 (exactly what's left) succeeds.
    const vaultInvestment = await service.create(
      { vaultId: investmentVaultId, name: "Fits Remaining Limit", instrumentType: "sukuk", allocatedAmount: "500", counterpartyId: limitedCounterparty.id, businessDescription: "Fixture business description for Shariah screening purposes." },
      actorUserId,
    );
    vaultInvestmentIds.push(vaultInvestment.id);
  });

  test("changeAllocation() re-checks the within-raised ceiling", async () => {
    const investment = await service.create(
      { vaultId: investmentVaultId, name: "Change Allocation Fixture", instrumentType: "sukuk", allocatedAmount: "100", counterpartyId: activeCounterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
      actorUserId,
    );
    vaultInvestmentIds.push(investment.id);

    await prisma.$transaction(async (tx) => {
      await expect(service.changeAllocation(investment.id, "999999", tx)).rejects.toThrow(BadRequestException);
    });
  });

  describe("Shariah screening", () => {
    let screeningVaultId: string;
    let screeningCounterpartyId: string;

    beforeAll(async () => {
      const vault = await vaultsService.create(
        { name: "Shariah Screening Fixture Vault", slug: `vault-shariah-screening-${Date.now()}`, type: "investment", currency: "USD", jurisdiction: "NG" },
        actorUserId,
      );
      screeningVaultId = vault.id;
      vaultIds.push(vault.id);

      const donor = await prisma.vaultDonor.create({ data: { email: `vault-investments-shariah-donor-${randomUUID()}@example.com` } });
      await prisma.vaultContribution.create({
        data: {
          vaultId: screeningVaultId,
          donorId: donor.id,
          amount: "5000",
          currency: "USD",
          provider: "paystack",
          providerReference: `vault-investments-shariah-spec-${randomUUID()}`,
          status: "confirmed",
        },
      });

      const counterparty = await prisma.counterparty.create({
        data: { name: `Vault Shariah Screening Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", status: "active" },
      });
      screeningCounterpartyId = counterparty.id;
    });

    afterAll(async () => {
      await prisma.counterparty.deleteMany({ where: { id: screeningCounterpartyId } });
    });

    test("create() starts a vault investment at pending_shariah_review with a VaultShariahScreening row on file", async () => {
      const investment = await service.create(
        {
          vaultId: screeningVaultId,
          name: "Fresh Sukuk",
          instrumentType: "sukuk",
          allocatedAmount: "500",
          counterpartyId: screeningCounterpartyId,
          businessDescription: "A sukuk backed by a portfolio of ijara leases on commercial real estate.",
        },
        actorUserId,
      );
      vaultInvestmentIds.push(investment.id);
      expect(investment.status).toBe("pending_shariah_review");

      const screening = await prisma.vaultShariahScreening.findUnique({ where: { vaultInvestmentId: investment.id } });
      expect(screening?.businessDescription).toBe("A sukuk backed by a portfolio of ijara leases on commercial real estate.");
      expect(screening?.decision).toBeNull();
    });

    test("recordShariahScreening() approve → status becomes active, decision recorded, audit-logged", async () => {
      const investment = await service.create(
        {
          vaultId: screeningVaultId,
          name: "Approve Fixture Sukuk",
          instrumentType: "sukuk",
          allocatedAmount: "300",
          counterpartyId: screeningCounterpartyId,
          businessDescription: "A sukuk backed by a portfolio of ijara leases on commercial real estate.",
        },
        actorUserId,
      );
      vaultInvestmentIds.push(investment.id);

      const updated = await service.recordShariahScreening(
        investment.id,
        { decision: "approved", interestBearingDebtConcern: false, nonCompliantIncomeConcern: false, reviewerNotes: "Clean sukuk structure, no concerns." },
        actorUserId,
      );
      expect(updated.status).toBe("active");

      const screening = await prisma.vaultShariahScreening.findUnique({ where: { vaultInvestmentId: investment.id } });
      expect(screening).toMatchObject({ decision: "approved", reviewerNotes: "Clean sukuk structure, no concerns.", decidedByUserId: actorUserId });
      expect(screening?.decidedAt).not.toBeNull();

      const logs = await prisma.auditLog.findMany({ where: { entityId: investment.id, action: "vault_investment.shariah_approved" } });
      expect(logs).toHaveLength(1);
    });

    test("recordShariahScreening() reject → status becomes shariah_rejected, audit-logged", async () => {
      const investment = await service.create(
        {
          vaultId: screeningVaultId,
          name: "Reject Fixture Sukuk",
          instrumentType: "equity_fund",
          allocatedAmount: "200",
          counterpartyId: screeningCounterpartyId,
          businessDescription: "An equity fund with meaningful exposure to online casino operators.",
        },
        actorUserId,
      );
      vaultInvestmentIds.push(investment.id);

      const updated = await service.recordShariahScreening(
        investment.id,
        { decision: "rejected", nonCompliantIncomeConcern: true, reviewerNotes: "Material gambling-sector revenue — not Shariah-compliant." },
        actorUserId,
      );
      expect(updated.status).toBe("shariah_rejected");

      const logs = await prisma.auditLog.findMany({ where: { entityId: investment.id, action: "vault_investment.shariah_rejected" } });
      expect(logs).toHaveLength(1);
    });

    test("recordShariahScreening() rejects a second decision on an already-decided screening", async () => {
      const investment = await service.create(
        {
          vaultId: screeningVaultId,
          name: "Already Decided Fixture Sukuk",
          instrumentType: "sukuk",
          allocatedAmount: "100",
          counterpartyId: screeningCounterpartyId,
          businessDescription: "A sukuk backed by a portfolio of ijara leases on commercial real estate.",
        },
        actorUserId,
      );
      vaultInvestmentIds.push(investment.id);
      await service.recordShariahScreening(investment.id, { decision: "approved", reviewerNotes: "First decision." }, actorUserId);

      await expect(
        service.recordShariahScreening(investment.id, { decision: "rejected", reviewerNotes: "Too late." }, actorUserId),
      ).rejects.toThrow("already been decided");
    });

    test("a pending_shariah_review vault investment still counts toward the raised ceiling, not just active ones", async () => {
      // 5000 raised for screeningVaultId. Prior tests left: 500 pending
      // (never decided), 300 active, 200 shariah_rejected (excluded —
      // no longer counts), 100 active. Committed = 500 + 300 + 100 =
      // 900, so 4100 remains.
      const pending = await service.create(
        {
          vaultId: screeningVaultId,
          name: "Ceiling Check Fixture Sukuk",
          instrumentType: "sukuk",
          allocatedAmount: "4100",
          counterpartyId: screeningCounterpartyId,
          businessDescription: "A sukuk backed by a portfolio of ijara leases on commercial real estate.",
        },
        actorUserId,
      );
      vaultInvestmentIds.push(pending.id);
      expect(pending.status).toBe("pending_shariah_review");

      await expect(
        service.create(
          {
            vaultId: screeningVaultId,
            name: "Should Exceed Raised",
            instrumentType: "sukuk",
            allocatedAmount: "1",
            counterpartyId: screeningCounterpartyId,
            businessDescription: "A sukuk backed by a portfolio of ijara leases on commercial real estate.",
          },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
