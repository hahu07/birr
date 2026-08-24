import { prisma } from "@birr/db";
import { WaqfCausesService } from "./waqf-causes.service";

describe("WaqfCausesService", () => {
  const service = new WaqfCausesService();

  const waqfCauseIds: string[] = [];
  const waqfIds: string[] = [];

  let waqfId: string;
  let actorUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `waqf-causes-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "mutawalli_officer" },
    });

    const foundation = await prisma.foundation.create({
      data: { name: "Waqf Causes Fixture Foundation" },
    });
    const waqf = await prisma.waqf.create({
      data: { name: "Waqf Causes Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    waqfId = waqf.id;
    waqfIds.push(waqf.id);
  });

  afterAll(async () => {
    await prisma.waqfCause.deleteMany({ where: { id: { in: waqfCauseIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  test("create() writes an audit_logs record attributed to the calling birr_staff, not \"system\"", async () => {
    const cause = await service.create({ waqfId, name: "Teacher Training" }, actorUserId);
    waqfCauseIds.push(cause.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: cause.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "WaqfCause",
      action: "waqf_cause.created",
      actorType: "birr_staff",
      actorUserId,
    });
  });
});
