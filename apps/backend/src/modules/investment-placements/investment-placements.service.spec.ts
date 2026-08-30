import { prisma, Prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { InvestmentsService } from "../investments/investments.service";
import { InvestmentPlacementsService } from "./investment-placements.service";

describe("InvestmentPlacementsService", () => {
  const service = new InvestmentPlacementsService(new InvestmentsService());

  const investmentIds: string[] = [];
  const placementIds: string[] = [];
  const waqfIds: string[] = [];
  const proceedsIds: string[] = [];

  let actorUserId: string;
  let counterpartyId: string;

  async function makeInvestmentWaqf(name: string, raisedAmount: string, corpusCurrency = "USD") {
    const foundation = await prisma.foundation.create({ data: { name: `${name} Foundation` } });
    const waqf = await prisma.waqf.create({
      data: { name, type: "investment", jurisdiction: "AE", foundationId: foundation.id, corpusCurrency },
    });
    waqfIds.push(waqf.id);
    await prisma.contribution.create({
      data: {
        waqfId: waqf.id,
        amount: raisedAmount,
        currency: corpusCurrency,
        provider: "paystack",
        providerReference: `placements-spec-${randomUUID()}`,
        status: "confirmed",
      },
    });
    return waqf.id;
  }

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as every other spec in this codebase.
    const actorUser = await prisma.user.create({
      data: { email: `placements-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "mutawalli_officer" } });

    const counterparty = await prisma.counterparty.create({
      data: { name: `Placements Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", status: "active" },
    });
    counterpartyId = counterparty.id;
  });

  afterAll(async () => {
    await prisma.waqfProceeds.deleteMany({ where: { id: { in: proceedsIds } } });
    await prisma.investment.deleteMany({ where: { id: { in: investmentIds } } });
    await prisma.investmentPlacement.deleteMany({ where: { id: { in: placementIds } } });
    await prisma.contribution.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.counterparty.deleteMany({ where: { id: counterpartyId } });
    await prisma.$disconnect();
  });

  test("create() bulk-places across 3 waqfs and links every Investment to the placement", async () => {
    const waqfA = await makeInvestmentWaqf(`Placement Fixture A ${randomUUID()}`, "1000");
    const waqfB = await makeInvestmentWaqf(`Placement Fixture B ${randomUUID()}`, "1000");
    const waqfC = await makeInvestmentWaqf(`Placement Fixture C ${randomUUID()}`, "1000");

    const placement = await service.create(
      {
        name: "3-Fund Sukuk Tranche",
        instrumentType: "sukuk",
        counterpartyId,
        allocations: [
          { waqfId: waqfA, amount: "300" },
          { waqfId: waqfB, amount: "500" },
          { waqfId: waqfC, amount: "200" },
        ],
      },
      actorUserId,
    );
    placementIds.push(placement.id);
    investmentIds.push(...placement.investments.map((i) => i.id));

    expect(placement.investments).toHaveLength(3);
    expect(placement.investments.every((i) => i.placementId === placement.id)).toBe(true);

    const detail = await service.findById(placement.id);
    expect(detail.investments).toHaveLength(3);
    expect(detail.investments.map((i) => i.allocatedAmount.toString()).sort()).toEqual(["200", "300", "500"]);
  });

  test("create() is all-or-nothing: one waqf over its own raised corpus rolls back the entire placement", async () => {
    const waqfOk = await makeInvestmentWaqf(`Placement Fixture OK ${randomUUID()}`, "1000");
    const waqfOver = await makeInvestmentWaqf(`Placement Fixture Over ${randomUUID()}`, "100");

    await expect(
      service.create(
        {
          name: "Should Roll Back",
          instrumentType: "murabaha",
          counterpartyId,
          allocations: [
            { waqfId: waqfOk, amount: "500" },
            // Only 100 was raised for this waqf — 200 exceeds it.
            { waqfId: waqfOver, amount: "200" },
          ],
        },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    // Neither leg exists — not even the one that would have been valid
    // on its own.
    const stray = await prisma.investment.findFirst({ where: { name: "Should Roll Back" } });
    expect(stray).toBeNull();
    const strayPlacement = await prisma.investmentPlacement.findFirst({ where: { name: "Should Roll Back" } });
    expect(strayPlacement).toBeNull();
  });

  test("create() rejects a combined total that would exceed the counterparty's concentration limit", async () => {
    const limited = await prisma.counterparty.create({
      data: {
        name: `Placements Fixture Limited Bank ${randomUUID()}`,
        institutionType: "bank",
        jurisdiction: "AE",
        status: "active",
        concentrationLimit: "1000",
        concentrationLimitCurrency: "USD",
      },
    });

    const waqfA = await makeInvestmentWaqf(`Placement Fixture Limit A ${randomUUID()}`, "5000");
    const waqfB = await makeInvestmentWaqf(`Placement Fixture Limit B ${randomUUID()}`, "5000");

    // 600 + 600 = 1200, past the 1000 limit — combined across the
    // placement's two legs, not checked per-leg in isolation.
    await expect(
      service.create(
        {
          name: "Should Exceed Concentration",
          instrumentType: "sukuk",
          counterpartyId: limited.id,
          allocations: [
            { waqfId: waqfA, amount: "600" },
            { waqfId: waqfB, amount: "600" },
          ],
        },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    const stray = await prisma.investment.findFirst({ where: { name: "Should Exceed Concentration" } });
    expect(stray).toBeNull();

    await prisma.counterparty.delete({ where: { id: limited.id } });
  });

  test("create() rejects waqfs with mismatched corpus currencies", async () => {
    const waqfUsd = await makeInvestmentWaqf(`Placement Fixture USD ${randomUUID()}`, "1000", "USD");
    const waqfNgn = await makeInvestmentWaqf(`Placement Fixture NGN ${randomUUID()}`, "1000000", "NGN");

    await expect(
      service.create(
        {
          name: "Should Reject Mixed Currency",
          instrumentType: "sukuk",
          counterpartyId,
          allocations: [
            { waqfId: waqfUsd, amount: "100" },
            { waqfId: waqfNgn, amount: "100" },
          ],
        },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("create() rejects an unknown waqf id", async () => {
    await expect(
      service.create(
        {
          name: "Should Reject Unknown Waqf",
          instrumentType: "sukuk",
          counterpartyId,
          allocations: [{ waqfId: "00000000-0000-0000-0000-000000000000", amount: "1" }],
        },
        actorUserId,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  describe("recordProceeds()", () => {
    let placementId: string;
    let waqfA: string;
    let waqfB: string;
    let waqfC: string;

    beforeAll(async () => {
      waqfA = await makeInvestmentWaqf(`Proceeds Fixture A ${randomUUID()}`, "1000");
      waqfB = await makeInvestmentWaqf(`Proceeds Fixture B ${randomUUID()}`, "1000");
      waqfC = await makeInvestmentWaqf(`Proceeds Fixture C ${randomUUID()}`, "1000");

      const placement = await service.create(
        {
          name: "Proceeds Fixture Placement",
          instrumentType: "murabaha",
          counterpartyId,
          // Uneven weights (1:1:1 of principal but the split below uses
          // an amount that doesn't divide evenly by 3) to exercise the
          // largest-remainder rounding through the real DB path too, not
          // just pro-rata.spec.ts's isolated unit tests.
          allocations: [
            { waqfId: waqfA, amount: "100" },
            { waqfId: waqfB, amount: "100" },
            { waqfId: waqfC, amount: "100" },
          ],
        },
        actorUserId,
      );
      placementId = placement.id;
      placementIds.push(placement.id);
      investmentIds.push(...placement.investments.map((i) => i.id));
    });

    test("splits one recorded return pro-rata across every contributing waqf's own WaqfProceeds", async () => {
      const rows = await service.recordProceeds(
        placementId,
        { amount: "100", currency: "USD", description: "Q1 return" },
        actorUserId,
      );
      proceedsIds.push(...rows.map((r) => r.id));

      expect(rows).toHaveLength(3);
      const total = rows.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0));
      expect(total.toString()).toBe("100");

      // Each row lands on the waqf its Investment leg actually belongs
      // to, and each row's own audit log is present.
      for (const row of rows) {
        expect(waqfIds).toContain(row.waqfId);
        const logs = await prisma.auditLog.findMany({ where: { entityId: row.id } });
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
          entityType: "WaqfProceeds",
          action: "waqf_proceeds.recorded",
          actorType: "birr_staff",
          actorUserId,
        });
      }
    });

    test("recordProceeds() rejects an unknown placement id", async () => {
      await expect(
        service.recordProceeds(
          "00000000-0000-0000-0000-000000000000",
          { amount: "10", currency: "USD", description: "n/a" },
          actorUserId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
