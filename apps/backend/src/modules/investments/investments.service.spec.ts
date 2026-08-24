import { prisma } from "@birr/db";
import { InvestmentsService } from "./investments.service";

describe("InvestmentsService", () => {
  const service = new InvestmentsService();

  const investmentIds: string[] = [];
  const waqfIds: string[] = [];

  let waqfId: string;
  let actorUserId: string;

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
  });

  afterAll(async () => {
    await prisma.investment.deleteMany({ where: { id: { in: investmentIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("create() writes the investment and a matching audit_logs record", async () => {
    const investment = await service.create(
      { waqfId, name: "Fixture Investment", instrumentType: "sukuk", allocatedAmount: "1000" },
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
});
