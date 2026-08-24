import { prisma } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { DistributionsService } from "./distributions.service";

describe("DistributionsService", () => {
  const service = new DistributionsService();

  const waqfIds: string[] = [];
  const beneficiaryIds: string[] = [];
  const waqfCauseIds: string[] = [];
  const distributionIds: string[] = [];

  let waqfAId: string;
  let waqfBId: string;
  let beneficiaryId: string;
  let causeOnWaqfAId: string;
  let causeOnWaqfBId: string;
  let actorUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `distributions-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "mutawalli_officer" },
    });

    const foundation = await prisma.foundation.create({
      data: { name: "Distributions Fixture Foundation" },
    });

    const waqfA = await prisma.waqf.create({
      data: { name: "Distributions Fixture Waqf A", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfAId = waqfA.id;
    waqfIds.push(waqfA.id);

    const waqfB = await prisma.waqf.create({
      data: { name: "Distributions Fixture Waqf B", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfBId = waqfB.id;
    waqfIds.push(waqfB.id);

    const beneficiary = await prisma.beneficiary.create({
      data: { waqfId: waqfAId, name: "Distributions Fixture Beneficiary", eligibilityCriteria: "Fixture" },
    });
    beneficiaryId = beneficiary.id;
    beneficiaryIds.push(beneficiary.id);

    const causeOnA = await prisma.waqfCause.create({
      data: { waqfId: waqfAId, name: "Cause On Waqf A" },
    });
    causeOnWaqfAId = causeOnA.id;
    waqfCauseIds.push(causeOnA.id);

    const causeOnB = await prisma.waqfCause.create({
      data: { waqfId: waqfBId, name: "Cause On Waqf B" },
    });
    causeOnWaqfBId = causeOnB.id;
    waqfCauseIds.push(causeOnB.id);
  });

  afterAll(async () => {
    await prisma.distribution.deleteMany({ where: { id: { in: distributionIds } } });
    await prisma.waqfCause.deleteMany({ where: { id: { in: waqfCauseIds } } });
    await prisma.beneficiary.deleteMany({ where: { id: { in: beneficiaryIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("create() succeeds when causeId belongs to the same waqf", async () => {
    const distribution = await service.create(
      {
        waqfId: waqfAId,
        beneficiaryId,
        causeId: causeOnWaqfAId,
        amount: "100",
      },
      actorUserId,
    );
    distributionIds.push(distribution.id);
    expect(distribution.causeId).toBe(causeOnWaqfAId);
  });

  test("create() rejects a causeId that belongs to a different waqf", async () => {
    await expect(
      service.create(
        {
          waqfId: waqfAId,
          beneficiaryId,
          causeId: causeOnWaqfBId,
          amount: "100",
        },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("create() writes a matching audit_logs record", async () => {
    const distribution = await service.create(
      {
        waqfId: waqfAId,
        beneficiaryId,
        causeId: causeOnWaqfAId,
        amount: "50",
      },
      actorUserId,
    );
    distributionIds.push(distribution.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: distribution.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "Distribution",
      action: "distribution.created",
      actorType: "birr_staff",
      actorUserId,
    });
  });
});
