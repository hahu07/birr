import { prisma } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { BeneficiariesService } from "./beneficiaries.service";

describe("BeneficiariesService", () => {
  const service = new BeneficiariesService();

  const waqfIds: string[] = [];
  const waqfCauseIds: string[] = [];
  const beneficiaryIds: string[] = [];

  let waqfAId: string;
  let waqfBId: string;
  let causeOnWaqfAId: string;
  let causeOnWaqfBId: string;
  let actorUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `beneficiaries-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "mutawalli_officer" },
    });

    const foundation = await prisma.foundation.create({
      data: { name: "Beneficiaries Fixture Foundation" },
    });

    const waqfA = await prisma.waqf.create({
      data: { name: "Beneficiaries Fixture Waqf A", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfAId = waqfA.id;
    waqfIds.push(waqfA.id);

    const waqfB = await prisma.waqf.create({
      data: { name: "Beneficiaries Fixture Waqf B", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfBId = waqfB.id;
    waqfIds.push(waqfB.id);

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
    await prisma.beneficiary.deleteMany({ where: { id: { in: beneficiaryIds } } });
    await prisma.waqfCause.deleteMany({ where: { id: { in: waqfCauseIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("create() succeeds when causeId belongs to the same waqf", async () => {
    const beneficiary = await service.create(
      {
        waqfId: waqfAId,
        causeId: causeOnWaqfAId,
        name: "Fixture Beneficiary With Cause",
        eligibilityCriteria: "Fixture criteria",
      },
      actorUserId,
    );
    beneficiaryIds.push(beneficiary.id);
    expect(beneficiary.causeId).toBe(causeOnWaqfAId);
  });

  test("create() rejects a causeId that belongs to a different waqf", async () => {
    await expect(
      service.create(
        {
          waqfId: waqfAId,
          causeId: causeOnWaqfBId,
          name: "Should Not Be Created",
          eligibilityCriteria: "Fixture criteria",
        },
        actorUserId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("create() succeeds with causeId omitted entirely (nullable)", async () => {
    const beneficiary = await service.create(
      {
        waqfId: waqfAId,
        name: "Fixture Beneficiary Without Cause",
        eligibilityCriteria: "Fixture criteria",
      },
      actorUserId,
    );
    beneficiaryIds.push(beneficiary.id);
    expect(beneficiary.causeId).toBeNull();
  });

  test("create() writes a matching audit_logs record", async () => {
    const beneficiary = await service.create(
      {
        waqfId: waqfAId,
        name: "Fixture Beneficiary For Audit Check",
        eligibilityCriteria: "Fixture criteria",
      },
      actorUserId,
    );
    beneficiaryIds.push(beneficiary.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: beneficiary.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "Beneficiary",
      action: "beneficiary.created",
      actorType: "birr_staff",
      actorUserId,
    });
  });
});
