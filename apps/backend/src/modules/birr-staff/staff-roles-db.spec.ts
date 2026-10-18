import { prisma, BirrStaffRole } from "@birr/db";
import { randomUUID } from "crypto";

// The birr_staff_roles rules are enforced by the database itself (triggers
// in migration 20261018120000_staff_multiple_roles), not only by the
// staff.role_add / staff.role_remove handlers. These tests write straight
// to the table, bypassing the app, to prove that.
describe("birr_staff_roles — database-enforced rules", () => {
  async function staffWith(...roles: BirrStaffRole[]) {
    // Fixtures not cleaned up — same reasoning as every other spec
    // (audit_logs references; insert-only at the DB role level).
    const user = await prisma.user.create({
      data: { email: `roles-db-${randomUUID().slice(0, 8)}@example.com`, fullName: "Roles DB Fixture" },
    });
    return prisma.birrStaff.create({ data: { userId: user.id, roles: { create: roles.map((role) => ({ role })) } } });
  }

  afterAll(() => prisma.$disconnect());

  test("an external_auditor can't be given another role", async () => {
    const staff = await staffWith("external_auditor");
    await expect(prisma.birrStaffRoleGrant.create({ data: { birrStaffId: staff.id, role: "legal_adviser" } })).rejects.toThrow(
      /external_auditor cannot hold any other staff role/,
    );
  });

  test("someone with another role can't be made an external_auditor", async () => {
    const staff = await staffWith("legal_adviser");
    await expect(prisma.birrStaffRoleGrant.create({ data: { birrStaffId: staff.id, role: "external_auditor" } })).rejects.toThrow(
      /external_auditor cannot hold any other staff role/,
    );
  });

  test("a staff member can't lose their last role", async () => {
    const staff = await staffWith("audit_committee");
    await expect(
      prisma.birrStaffRoleGrant.delete({ where: { birrStaffId_role: { birrStaffId: staff.id, role: "audit_committee" } } }),
    ).rejects.toThrow(/must keep at least one role/);
  });

  test("a role row is never edited in place", async () => {
    const staff = await staffWith("audit_committee");
    await expect(
      prisma.birrStaffRoleGrant.update({
        where: { birrStaffId_role: { birrStaffId: staff.id, role: "audit_committee" } },
        data: { role: "board_of_trustees" },
      }),
    ).rejects.toThrow(/added or removed, never edited/);
  });

  test("ordinary roles combine freely, and one of two can be removed", async () => {
    const staff = await staffWith("legal_adviser", "compliance_officer");
    await prisma.birrStaffRoleGrant.delete({ where: { birrStaffId_role: { birrStaffId: staff.id, role: "legal_adviser" } } });
    const remaining = await prisma.birrStaffRoleGrant.findMany({ where: { birrStaffId: staff.id } });
    expect(remaining.map((r) => r.role)).toEqual(["compliance_officer"]);
  });
});
