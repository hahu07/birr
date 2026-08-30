import { prisma } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { InvestmentsService } from "./investments.service";

describe("InvestmentsService", () => {
  const service = new InvestmentsService();

  const investmentIds: string[] = [];
  const waqfIds: string[] = [];

  let waqfId: string;
  let actorUserId: string;
  let activeCounterpartyId: string;
  let pendingCounterpartyId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `investments-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "mutawalli_officer" },
    });

    const foundation = await prisma.foundation.create({
      data: { name: "Investments Fixture Foundation" },
    });
    const waqf = await prisma.waqf.create({
      data: { name: "Investments Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfId = waqf.id;
    waqfIds.push(waqf.id);
    // A waqf can't invest more than it's actually raised — this fixture
    // needs real confirmed Contributions to allocate against.
    await prisma.contribution.create({
      data: {
        waqfId,
        amount: "2000",
        currency: "USD",
        provider: "paystack",
        providerReference: `investments-spec-${randomUUID()}`,
        status: "confirmed",
      },
    });

    const activeCounterparty = await prisma.counterparty.create({
      data: { name: `Investments Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", status: "active" },
    });
    activeCounterpartyId = activeCounterparty.id;
    const pendingCounterparty = await prisma.counterparty.create({
      data: { name: `Investments Fixture Pending Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE" },
    });
    pendingCounterpartyId = pendingCounterparty.id;
  });

  afterAll(async () => {
    await prisma.investment.deleteMany({ where: { id: { in: investmentIds } } });
    await prisma.contribution.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.counterparty.deleteMany({ where: { id: { in: [activeCounterpartyId, pendingCounterpartyId] } } });
    await prisma.$disconnect();
  });

  test("create() writes the investment and a matching audit_logs record", async () => {
    const investment = await service.create(
      { waqfId, name: "Fixture Investment", instrumentType: "sukuk", allocatedAmount: "1000", counterpartyId: activeCounterpartyId },
      actorUserId,
    );
    investmentIds.push(investment.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: investment.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "Investment",
      action: "investment.created",
      actorType: "birr_staff",
      actorUserId,
    });
  });

  test("create() rejects an Investment against a non-Investment-type waqf", async () => {
    const foundation = await prisma.foundation.create({ data: { name: "Investments Fixture Foundation (Asset)" } });
    const assetWaqf = await prisma.waqf.create({
      data: { name: "Investments Fixture Asset Waqf", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfIds.push(assetWaqf.id);

    await expect(
      service.create(
        { waqfId: assetWaqf.id, name: "Should Be Rejected", instrumentType: "sukuk", allocatedAmount: "500", counterpartyId: activeCounterpartyId },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    const created = await prisma.investment.findFirst({ where: { name: "Should Be Rejected" } });
    expect(created).toBeNull();
  });

  test("create() rejects committing more than the waqf's raised amount across its investments", async () => {
    // 1000 already committed (the first test above) out of 2000 raised —
    // 1500 more would push the total past what's actually been raised.
    await expect(
      service.create(
        { waqfId, name: "Should Exceed Raised", instrumentType: "sukuk", allocatedAmount: "1500", counterpartyId: activeCounterpartyId },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    // Exactly the remaining 1000 succeeds.
    const investment = await service.create(
      { waqfId, name: "Second Fixture Investment", instrumentType: "equity_fund", allocatedAmount: "1000", counterpartyId: activeCounterpartyId },
      actorUserId,
    );
    investmentIds.push(investment.id);
  });

  test("changeAllocation() re-checks the ceiling and rejects raising past what's raised", async () => {
    const investment = await prisma.investment.findFirstOrThrow({ where: { waqfId, name: "Second Fixture Investment" } });

    // The waqf's 2000 raised is now fully committed (1000 + 1000) —
    // raising this one to 1500 would push the total to 2500.
    await prisma.$transaction(async (tx) => {
      await expect(service.changeAllocation(investment.id, "1500", tx)).rejects.toThrow(BadRequestException);
    });

    // Lowering it stays within the ceiling and succeeds.
    const updated = await prisma.$transaction((tx) => service.changeAllocation(investment.id, "500", tx));
    expect(updated.allocatedAmount.toString()).toBe("500");
  });

  test("create() rejects a counterparty that hasn't been onboarded yet", async () => {
    await expect(
      service.create(
        { waqfId, name: "Should Be Rejected", instrumentType: "sukuk", allocatedAmount: "1", counterpartyId: pendingCounterpartyId },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    const created = await prisma.investment.findFirst({ where: { name: "Should Be Rejected" } });
    expect(created).toBeNull();
  });

  describe("concentration limit — enforced across every waqf combined", () => {
    let limitedCounterpartyId: string;
    let firstWaqfId: string;
    let secondWaqfId: string;

    beforeAll(async () => {
      const counterparty = await prisma.counterparty.create({
        data: {
          name: `Investments Fixture Limited Bank ${randomUUID()}`,
          institutionType: "bank",
          jurisdiction: "AE",
          status: "active",
          concentrationLimit: "1500",
          concentrationLimitCurrency: "USD",
        },
      });
      limitedCounterpartyId = counterparty.id;

      const foundation = await prisma.foundation.create({ data: { name: "Investments Fixture Foundation (Concentration)" } });
      const [firstWaqf, secondWaqf] = await Promise.all([
        prisma.waqf.create({
          data: { name: "Investments Fixture First Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
        }),
        prisma.waqf.create({
          data: { name: "Investments Fixture Second Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
        }),
      ]);
      firstWaqfId = firstWaqf.id;
      secondWaqfId = secondWaqf.id;
      waqfIds.push(firstWaqfId, secondWaqfId);
      await Promise.all(
        [firstWaqfId, secondWaqfId].map((id) =>
          prisma.contribution.create({
            data: {
              waqfId: id,
              amount: "5000",
              currency: "USD",
              provider: "paystack",
              providerReference: `investments-spec-concentration-${id}`,
              status: "confirmed",
            },
          }),
        ),
      );
    });

    afterAll(async () => {
      await prisma.counterparty.deleteMany({ where: { id: limitedCounterpartyId } });
    });

    test("rejects a second waqf's investment that would push combined exposure past the limit", async () => {
      const first = await service.create(
        { waqfId: firstWaqfId, name: "First Waqf's Investment", instrumentType: "sukuk", allocatedAmount: "1000", counterpartyId: limitedCounterpartyId },
        actorUserId,
      );
      investmentIds.push(first.id);

      // 1000 already committed (a different waqf) out of a 1500 limit —
      // 600 more from THIS waqf would push combined exposure to 1600.
      await expect(
        service.create(
          { waqfId: secondWaqfId, name: "Second Waqf's Investment", instrumentType: "sukuk", allocatedAmount: "600", counterpartyId: limitedCounterpartyId },
          actorUserId,
        ),
      ).rejects.toThrow(BadRequestException);

      // Exactly the remaining 500 succeeds.
      const second = await service.create(
        { waqfId: secondWaqfId, name: "Second Waqf's Investment", instrumentType: "sukuk", allocatedAmount: "500", counterpartyId: limitedCounterpartyId },
        actorUserId,
      );
      investmentIds.push(second.id);
    });
  });
});
