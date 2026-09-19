import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { VaultInvestmentsService } from "./vault-investments.service";
import { VaultInvestmentTargetsService } from "./vault-investment-targets.service";
import { PORTFOLIO_DRIFT_THRESHOLD_PERCENT } from "../investments/investment-drift.constants";

describe("VaultInvestmentTargetsService", () => {
  const targetsService = new VaultInvestmentTargetsService();
  const vaultInvestmentsService = new VaultInvestmentsService();

  const vaultIds: string[] = [];
  const vaultInvestmentIds: string[] = [];

  let actorUserId: string;
  let counterpartyId: string;

  async function makeInvestmentVault(name: string, raisedAmount: string) {
    const vault = await prisma.vault.create({
      data: { name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID()}`, type: "investment", currency: "USD", jurisdiction: "NG", createdByUserId: actorUserId },
    });
    vaultIds.push(vault.id);
    await prisma.vaultContribution.create({
      data: {
        vaultId: vault.id,
        amount: raisedAmount,
        currency: "USD",
        provider: "paystack",
        providerReference: `vault-investment-targets-spec-${randomUUID()}`,
        status: "confirmed",
      },
    });
    return vault.id;
  }

  beforeAll(async () => {
    const actorUser = await prisma.user.create({
      data: { email: `vault-investment-targets-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "investment_committee" } });

    const counterparty = await prisma.counterparty.create({
      data: { name: `Vault Investment Targets Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", status: "active" },
    });
    counterpartyId = counterparty.id;
  });

  afterAll(async () => {
    await prisma.vaultInvestmentTarget.deleteMany({ where: { vaultId: { in: vaultIds } } });
    // RESTRICT on vaultInvestmentId, must go before VaultInvestment itself.
    await prisma.vaultShariahScreening.deleteMany({ where: { vaultInvestmentId: { in: vaultInvestmentIds } } });
    await prisma.vaultInvestment.deleteMany({ where: { id: { in: vaultInvestmentIds } } });
    await prisma.vaultContribution.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.counterparty.deleteMany({ where: { id: counterpartyId } });
    await prisma.$disconnect();
  });

  describe("target CRUD", () => {
    let crudVaultId: string;

    beforeAll(async () => {
      crudVaultId = await makeInvestmentVault(`Vault Investment Targets CRUD Fixture ${randomUUID()}`, "1000");
    });

    test("upsertTarget() creates a new target row and audit-logs it", async () => {
      const target = await targetsService.upsertTarget(crudVaultId, { instrumentType: "sukuk", targetPercent: "60" }, actorUserId);
      expect(target.targetPercent.toString()).toBe("60");

      const logs = await prisma.auditLog.findMany({ where: { entityId: target.id } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        entityType: "VaultInvestmentTarget",
        action: "vault_investment_target.set",
        actorType: "birr_staff",
        actorUserId,
      });
    });

    test("upsertTarget() updates an existing target for the same instrumentType (upsert, not duplicate row)", async () => {
      await targetsService.upsertTarget(crudVaultId, { instrumentType: "sukuk", targetPercent: "55" }, actorUserId);

      const rows = await prisma.vaultInvestmentTarget.findMany({ where: { vaultId: crudVaultId, instrumentType: "sukuk" } });
      expect(rows).toHaveLength(1);
      expect(rows[0].targetPercent.toString()).toBe("55");
    });

    test("upsertTarget() rejects a target set that would push the vault's total over 100%", async () => {
      await expect(
        targetsService.upsertTarget(crudVaultId, { instrumentType: "equity_fund", targetPercent: "50" }, actorUserId),
      ).rejects.toThrow(BadRequestException);
    });

    test("remove() deletes a target row and audit-logs it", async () => {
      const target = await targetsService.upsertTarget(crudVaultId, { instrumentType: "other", targetPercent: "10" }, actorUserId);

      await targetsService.remove(crudVaultId, "other", actorUserId);

      const found = await prisma.vaultInvestmentTarget.findUnique({ where: { id: target.id } });
      expect(found).toBeNull();

      const logs = await prisma.auditLog.findMany({ where: { entityId: target.id, action: "vault_investment_target.removed" } });
      expect(logs).toHaveLength(1);
    });

    test("remove() throws NotFoundException for a target that was never set", async () => {
      await expect(targetsService.remove(crudVaultId, "real_estate_fund", actorUserId)).rejects.toThrow(NotFoundException);
    });
  });

  describe("drift computation", () => {
    test("a vault with no targets returns anyDrifted: false and an empty breakdown", async () => {
      const emptyVaultId = await makeInvestmentVault(`Vault Investment Targets No-Target Fixture ${randomUUID()}`, "1000");
      const report = await targetsService.computeDrift(emptyVaultId);
      expect(report).toMatchObject({ vaultId: emptyVaultId, totalCommittedAmount: "0", currency: null, breakdown: [], anyDrifted: false });
    });

    test("computes exact drift percentages for a known fixture, and only counts COMMITTED_INVESTMENT_STATUSES investments", async () => {
      const driftVaultId = await makeInvestmentVault(`Vault Investment Targets Drift Fixture ${randomUUID()}`, "2000");

      const sukuk = await vaultInvestmentsService.create(
        { vaultId: driftVaultId, name: "Vault Drift Fixture Sukuk", instrumentType: "sukuk", allocatedAmount: "500", counterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      );
      const equity = await vaultInvestmentsService.create(
        { vaultId: driftVaultId, name: "Vault Drift Fixture Equity", instrumentType: "equity_fund", allocatedAmount: "300", counterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      );
      const murabaha = await vaultInvestmentsService.create(
        { vaultId: driftVaultId, name: "Vault Drift Fixture Murabaha", instrumentType: "murabaha", allocatedAmount: "200", counterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      );
      vaultInvestmentIds.push(sukuk.id, equity.id, murabaha.id);

      const liquidated = await vaultInvestmentsService.create(
        { vaultId: driftVaultId, name: "Vault Drift Fixture Liquidated Real Estate", instrumentType: "real_estate_fund", allocatedAmount: "100", counterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      );
      vaultInvestmentIds.push(liquidated.id);
      await prisma.vaultInvestment.update({ where: { id: liquidated.id }, data: { status: "liquidated" } });

      await targetsService.upsertTarget(driftVaultId, { instrumentType: "sukuk", targetPercent: "60" }, actorUserId);
      await targetsService.upsertTarget(driftVaultId, { instrumentType: "equity_fund", targetPercent: "40" }, actorUserId);

      const report = await targetsService.computeDrift(driftVaultId);
      expect(report.totalCommittedAmount).toBe("1000");
      expect(report.currency).toBe("USD");
      expect(report.breakdown).toHaveLength(2);

      const sukukRow = report.breakdown.find((b) => b.instrumentType === "sukuk")!;
      expect(sukukRow.actualPercent).toBe("50");
      expect(sukukRow.driftPercentagePoints).toBe("-10");
      expect(sukukRow.drifted).toBe(false);

      expect(report.breakdown.some((b) => b.instrumentType === "murabaha")).toBe(false);

      await targetsService.upsertTarget(driftVaultId, { instrumentType: "sukuk", targetPercent: "20" }, actorUserId);
      const drifted = await targetsService.computeDrift(driftVaultId);
      const driftedSukuk = drifted.breakdown.find((b) => b.instrumentType === "sukuk")!;
      expect(driftedSukuk.driftPercentagePoints).toBe("30");
      expect(Number(driftedSukuk.driftPercentagePoints)).toBeGreaterThan(PORTFOLIO_DRIFT_THRESHOLD_PERCENT);
      expect(driftedSukuk.drifted).toBe(true);
      expect(drifted.anyDrifted).toBe(true);
    });
  });
});
