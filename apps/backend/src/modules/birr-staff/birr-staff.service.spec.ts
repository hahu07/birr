import { prisma } from "@birr/db";
import { BirrStaffService } from "./birr-staff.service";

describe("BirrStaffService", () => {
  const service = new BirrStaffService();

  const staffIds: string[] = [];
  let actorUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `birr-staff-actor-${Date.now()}@example.com`, fullName: "Test Admin Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({
      data: { userId: actorUser.id, staffRole: "platform_admin" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("create() writes an audit_logs record attributed to the calling platform_admin, not \"system\"", async () => {
    const staff = await service.create(
      {
        email: `birr-staff-new-${Date.now()}@example.com`,
        fullName: "New Staff Member",
        staffRole: "compliance_officer",
      },
      actorUserId,
    );
    staffIds.push(staff.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: staff.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: "BirrStaff",
      action: "birr_staff.created",
      actorType: "birr_staff",
      actorUserId,
    });
  });
});
