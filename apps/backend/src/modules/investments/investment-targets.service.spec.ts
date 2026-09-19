import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { InvestmentsService } from "./investments.service";
import { InvestmentTargetsService } from "./investment-targets.service";
import { PORTFOLIO_DRIFT_THRESHOLD_PERCENT } from "./investment-drift.constants";

describe("InvestmentTargetsService", () => {
  const targetsService = new InvestmentTargetsService();
  const investmentsService = new InvestmentsService();

  const waqfIds: string[] = [];
  const investmentIds: string[] = [];

  let actorUserId: string;
  let counterpartyId: string;

  async function makeInvestmentWaqf(name: string, raisedAmount: string) {
    const foundation = await prisma.foundation.create({ data: { name: `${name} Foundation` } });
    const waqf = await prisma.waqf.create({
      data: { name, type: "investment", jurisdiction: "AE", foundationId: foundation.id, corpusCurrency: "USD" },
    });
    waqfIds.push(waqf.id);
    await prisma.contribution.create({
      data: {
        waqfId: waqf.id,
        amount: raisedAmount,
        currency: "USD",
        provider: "paystack",
        providerReference: `investment-targets-spec-${randomUUID()}`,
        status: "confirmed",
      },
    });
    return waqf.id;
  }

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as every other spec in this codebase.
    const actorUser = await prisma.user.create({
      data: { email: `investment-targets-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "investment_committee" } });

    const counterparty = await prisma.counterparty.create({
      data: { name: `Investment Targets Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", status: "active" },
    });
    counterpartyId = counterparty.id;
  });

  afterAll(async () => {
    await prisma.investmentTarget.deleteMany({ where: { waqfId: { in: waqfIds } } });
    // RESTRICT on investmentId, must go before Investment itself.
    await prisma.shariahScreening.deleteMany({ where: { investmentId: { in: investmentIds } } });
    await prisma.investment.deleteMany({ where: { id: { in: investmentIds } } });
    await prisma.contribution.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.counterparty.deleteMany({ where: { id: counterpartyId } });
    await prisma.$disconnect();
  });

  describe("target CRUD", () => {
    let crudWaqfId: string;

    beforeAll(async () => {
      crudWaqfId = await makeInvestmentWaqf(`Investment Targets CRUD Fixture ${randomUUID()}`, "1000");
    });

    test("upsertTarget() creates a new target row and audit-logs it", async () => {
      const target = await targetsService.upsertTarget(crudWaqfId, { instrumentType: "sukuk", targetPercent: "60" }, actorUserId);
      expect(target.targetPercent.toString()).toBe("60");

      const logs = await prisma.auditLog.findMany({ where: { entityId: target.id } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        entityType: "InvestmentTarget",
        action: "investment_target.set",
        actorType: "birr_staff",
        actorUserId,
      });
    });

    test("upsertTarget() updates an existing target for the same instrumentType (upsert, not duplicate row)", async () => {
      await targetsService.upsertTarget(crudWaqfId, { instrumentType: "sukuk", targetPercent: "55" }, actorUserId);

      const rows = await prisma.investmentTarget.findMany({ where: { waqfId: crudWaqfId, instrumentType: "sukuk" } });
      expect(rows).toHaveLength(1);
      expect(rows[0].targetPercent.toString()).toBe("55");

      const logs = await prisma.auditLog.findMany({ where: { entityId: rows[0].id, action: "investment_target.set" } });
      expect(logs).toHaveLength(2);
    });

    test("upsertTarget() rejects a target set that would push the waqf's total over 100%", async () => {
      // sukuk is already 55 from the previous test — 55 + 50 = 105.
      await expect(
        targetsService.upsertTarget(crudWaqfId, { instrumentType: "equity_fund", targetPercent: "50" }, actorUserId),
      ).rejects.toThrow(BadRequestException);

      const equityTarget = await prisma.investmentTarget.findUnique({
        where: { waqfId_instrumentType: { waqfId: crudWaqfId, instrumentType: "equity_fund" } },
      });
      expect(equityTarget).toBeNull();
    });

    test("upsertTarget() rejects a single value outside 0-100", async () => {
      await expect(
        targetsService.upsertTarget(crudWaqfId, { instrumentType: "murabaha", targetPercent: "-5" }, actorUserId),
      ).rejects.toThrow(BadRequestException);
      await expect(
        targetsService.upsertTarget(crudWaqfId, { instrumentType: "murabaha", targetPercent: "101" }, actorUserId),
      ).rejects.toThrow(BadRequestException);
    });

    test("remove() deletes a target row and audit-logs it", async () => {
      const target = await targetsService.upsertTarget(crudWaqfId, { instrumentType: "other", targetPercent: "10" }, actorUserId);

      await targetsService.remove(crudWaqfId, "other", actorUserId);

      const found = await prisma.investmentTarget.findUnique({ where: { id: target.id } });
      expect(found).toBeNull();

      const logs = await prisma.auditLog.findMany({ where: { entityId: target.id, action: "investment_target.removed" } });
      expect(logs).toHaveLength(1);
    });

    test("remove() throws NotFoundException for a target that was never set", async () => {
      await expect(targetsService.remove(crudWaqfId, "real_estate_fund", actorUserId)).rejects.toThrow(NotFoundException);
    });
  });

  describe("drift computation", () => {
    test("a fund with no targets returns anyDrifted: false and an empty breakdown", async () => {
      const emptyWaqfId = await makeInvestmentWaqf(`Investment Targets No-Target Fixture ${randomUUID()}`, "1000");
      const report = await targetsService.computeDrift(emptyWaqfId);
      expect(report).toMatchObject({ waqfId: emptyWaqfId, totalCommittedAmount: "0", currency: null, breakdown: [], anyDrifted: false });
    });

    test("computes exact drift percentages for a known fixture, and only counts COMMITTED_INVESTMENT_STATUSES investments", async () => {
      const driftWaqfId = await makeInvestmentWaqf(`Investment Targets Drift Fixture ${randomUUID()}`, "2000");

      // 500 sukuk + 300 equity_fund + 200 murabaha = 1000 committed
      // (each new Investment starts pending_shariah_review, which still
      // counts — see COMMITTED_INVESTMENT_STATUSES).
      const sukuk = await investmentsService.create(
        { waqfId: driftWaqfId, name: "Drift Fixture Sukuk", instrumentType: "sukuk", allocatedAmount: "500", counterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      );
      const equity = await investmentsService.create(
        { waqfId: driftWaqfId, name: "Drift Fixture Equity", instrumentType: "equity_fund", allocatedAmount: "300", counterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      );
      const murabaha = await investmentsService.create(
        { waqfId: driftWaqfId, name: "Drift Fixture Murabaha", instrumentType: "murabaha", allocatedAmount: "200", counterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      );
      investmentIds.push(sukuk.id, equity.id, murabaha.id);

      // A liquidated investment should NOT count toward actual allocation.
      const liquidated = await investmentsService.create(
        { waqfId: driftWaqfId, name: "Drift Fixture Liquidated Real Estate", instrumentType: "real_estate_fund", allocatedAmount: "100", counterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        actorUserId,
      );
      investmentIds.push(liquidated.id);
      await prisma.investment.update({ where: { id: liquidated.id }, data: { status: "liquidated" } });

      // Targets: sukuk 60%, equity_fund 40% — actual is sukuk 50%,
      // equity_fund 30% (out of the 1000 committed, liquidated excluded).
      await targetsService.upsertTarget(driftWaqfId, { instrumentType: "sukuk", targetPercent: "60" }, actorUserId);
      await targetsService.upsertTarget(driftWaqfId, { instrumentType: "equity_fund", targetPercent: "40" }, actorUserId);

      const report = await targetsService.computeDrift(driftWaqfId);
      expect(report.totalCommittedAmount).toBe("1000");
      expect(report.currency).toBe("USD");
      expect(report.breakdown).toHaveLength(2);

      const sukukRow = report.breakdown.find((b) => b.instrumentType === "sukuk")!;
      expect(sukukRow.actualPercent).toBe("50");
      expect(sukukRow.driftPercentagePoints).toBe("-10");
      // Exactly at the threshold (10pp) — strict > means this is NOT drifted.
      expect(sukukRow.drifted).toBe(false);

      const equityRow = report.breakdown.find((b) => b.instrumentType === "equity_fund")!;
      expect(equityRow.actualPercent).toBe("30");
      expect(equityRow.driftPercentagePoints).toBe("-10");
      expect(equityRow.drifted).toBe(false);

      expect(report.anyDrifted).toBe(false);

      // murabaha has real committed money (200) but no target row — it
      // must be excluded from the breakdown entirely.
      expect(report.breakdown.some((b) => b.instrumentType === "murabaha")).toBe(false);

      // Now push sukuk's target down so actual (50%) drifts past the
      // threshold: 50 - 20 = 30pp > PORTFOLIO_DRIFT_THRESHOLD_PERCENT.
      await targetsService.upsertTarget(driftWaqfId, { instrumentType: "sukuk", targetPercent: "20" }, actorUserId);
      const drifted = await targetsService.computeDrift(driftWaqfId);
      const driftedSukuk = drifted.breakdown.find((b) => b.instrumentType === "sukuk")!;
      expect(driftedSukuk.driftPercentagePoints).toBe("30");
      expect(Number(driftedSukuk.driftPercentagePoints)).toBeGreaterThan(PORTFOLIO_DRIFT_THRESHOLD_PERCENT);
      expect(driftedSukuk.drifted).toBe(true);
      expect(drifted.anyDrifted).toBe(true);
    });
  });
});
