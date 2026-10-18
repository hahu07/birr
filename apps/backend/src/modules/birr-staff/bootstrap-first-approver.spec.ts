import { prisma } from "@birr/db";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { bootstrapFirstApprover } from "./bootstrap-first-approver";

describe("bootstrapFirstApprover", () => {
  const stamp = Date.now();
  const REASON = "First Board member on a new deployment; identity confirmed in person.";
  let adminEmail: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up — audit_logs references them
    // and that table is insert-only at the DB role level.
    const admin = await prisma.user.create({
      data: { email: `bootstrap-admin-${stamp}@example.com`, fullName: "Bootstrap Admin" },
    });
    await prisma.birrStaff.create({ data: { userId: admin.id, staffRole: "platform_admin" } });
    adminEmail = admin.email;
    // Guarantees an active approver exists, whatever else the shared test
    // database holds — the "no approver yet" path is exercised inside a
    // rolled-back transaction below.
    const board = await prisma.user.create({
      data: { email: `bootstrap-board-${stamp}@example.com`, fullName: "Bootstrap Existing Board" },
    });
    await prisma.birrStaff.create({ data: { userId: board.id, staffRole: "board_of_trustees" } });
  });

  afterAll(() => prisma.$disconnect());

  const input = (overrides: Partial<Parameters<typeof bootstrapFirstApprover>[0]> = {}) => ({
    email: `bootstrap-new-${stamp}-${Math.floor(Math.random() * 10000)}@example.com`,
    staffRole: "board_of_trustees",
    invitedByEmail: adminEmail,
    reason: REASON,
    execute: true,
    ...overrides,
  });

  // The shared test database always holds some active approver, so the
  // "nobody to approve yet" path swaps in a lookup that finds none.
  const noApprover = { findActiveApprover: async () => null };

  test("refuses once any active Board/Compliance member exists", async () => {
    const args = input();
    await expect(bootstrapFirstApprover(args)).rejects.toThrow(BadRequestException);
    expect(await prisma.invitation.count({ where: { email: args.email } })).toBe(0);
  });

  test("refuses any role other than board_of_trustees / compliance_officer, and a short reason", async () => {
    await expect(bootstrapFirstApprover(input({ staffRole: "platform_admin" }))).rejects.toThrow(BadRequestException);
    await expect(bootstrapFirstApprover(input({ reason: "too short" }))).rejects.toThrow(BadRequestException);
  });

  test("with no approver yet: a dry run changes nothing", async () => {
    const args = input({ execute: false });
    const result = await bootstrapFirstApprover(args, noApprover);
    expect(result.executed).toBe(false);
    expect(result.acceptUrl).toBeUndefined();
    expect(await prisma.invitation.count({ where: { email: args.email } })).toBe(0);
  });

  test("with no approver yet: --execute creates the invitation, audit-logs it without the token, and returns the link", async () => {
    const args = input();
    const result = await bootstrapFirstApprover(args, noApprover);
    expect(result.executed).toBe(true);

    const invitation = await prisma.invitation.findFirstOrThrow({ where: { email: args.email } });
    expect(invitation).toMatchObject({ inviteeKind: "birr_staff", roleKey: "board_of_trustees", status: "pending" });
    expect(result.acceptUrl).toContain(invitation.token);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: invitation.id, action: "invitation.bootstrap_sent" } });
    expect(log.actorType).toBe("system");
    expect(JSON.stringify(log.after)).not.toContain(invitation.token);
    expect(JSON.stringify(log.after)).toContain(REASON);
  });

  test("with no approver yet: still refuses an existing account, or an inviter who isn't a platform_admin", async () => {
    await expect(bootstrapFirstApprover(input({ email: adminEmail }), noApprover)).rejects.toThrow(ConflictException);
    await expect(
      bootstrapFirstApprover(input({ invitedByEmail: `nobody-${stamp}@example.com` }), noApprover),
    ).rejects.toThrow(NotFoundException);
  });
});
