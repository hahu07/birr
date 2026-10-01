import { prisma, BirrStaffRole } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { emergencyMfaReset } from "./emergency-mfa-reset";

describe("emergencyMfaReset", () => {
  const stamp = Date.now();
  const users: Record<string, { id: string; email: string }> = {};
  const REASON = "Lone platform admin lost phone and backup codes; identity confirmed on a video call.";

  async function makeStaff(key: string, staffRole: BirrStaffRole, mfa = false) {
    // Fixture Users/BirrStaff not cleaned up — audit_logs references them
    // and that table is insert-only at the DB role level.
    const user = await prisma.user.create({
      data: { email: `emergency-${key}-${stamp}@example.com`.toLowerCase(), fullName: `Emergency ${key}`, mfaEnabled: mfa, mfaSecretEncrypted: mfa ? "not-a-real-secret" : null },
    });
    await prisma.birrStaff.create({ data: { userId: user.id, staffRole } });
    if (mfa) await prisma.mfaBackupCode.createMany({ data: [{ userId: user.id, codeHash: "x" }, { userId: user.id, codeHash: "y" }] });
    users[key] = { id: user.id, email: user.email };
  }

  beforeAll(async () => {
    await makeStaff("target", "platform_admin", true);
    await makeStaff("board", "board_of_trustees");
    await makeStaff("compliance", "compliance_officer");
    await makeStaff("officer", "mutawalli_officer");
    await makeStaff("noMfa", "platform_admin", false);
  });

  afterAll(() => prisma.$disconnect());

  const run = (overrides: Partial<Parameters<typeof emergencyMfaReset>[0]> = {}) =>
    emergencyMfaReset({
      targetEmail: users.target.email,
      approverEmails: [users.board.email, users.compliance.email],
      reason: REASON,
      execute: false,
      ...overrides,
    });

  const targetStillEnrolled = async () => (await prisma.user.findUniqueOrThrow({ where: { id: users.target.id } })).mfaEnabled;

  it("a dry run describes the reset and changes nothing", async () => {
    const result = await run();
    expect(result.executed).toBe(false);
    expect(result.summary.join("\n")).toContain(users.target.email);
    expect(await targetStillEnrolled()).toBe(true);
    expect(await prisma.mfaBackupCode.count({ where: { userId: users.target.id } })).toBe(2);
  });

  it("refuses a short or missing reason", async () => {
    await expect(run({ reason: "lost it" })).rejects.toThrow(BadRequestException);
  });

  it("refuses the same person as both approvers, or the target as an approver", async () => {
    await expect(run({ approverEmails: [users.board.email, users.board.email.toUpperCase()] })).rejects.toThrow(/two different people/);
    await expect(run({ approverEmails: [users.board.email, users.target.email] })).rejects.toThrow(/cannot be the person/);
  });

  it("refuses approvers who aren't Board/Compliance (e.g. a Mutawalli Officer)", async () => {
    await expect(run({ approverEmails: [users.board.email, users.officer.email] })).rejects.toThrow(/emergency approvers must be/);
  });

  it("refuses a target with no MFA enrolled, and unknown accounts", async () => {
    await expect(run({ targetEmail: users.noMfa.email })).rejects.toThrow(/nothing to reset/);
    await expect(run({ targetEmail: "nobody@example.com" })).rejects.toThrow(/not a Birr staff account/);
    expect(await targetStillEnrolled()).toBe(true);
  });

  it("--execute clears MFA and backup codes, audit-logs both approvers and the reason, and leaves an in-app notice", async () => {
    const result = await run({ execute: true });
    expect(result.executed).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: users.target.id } });
    expect(user.mfaEnabled).toBe(false);
    expect(user.mfaSecretEncrypted).toBeNull();
    expect(await prisma.mfaBackupCode.count({ where: { userId: users.target.id } })).toBe(0);

    const logs = await prisma.auditLog.findMany({ where: { entityId: users.target.id, action: "birr_staff.mfa_reset_emergency" } });
    expect(logs).toHaveLength(1);
    expect(logs[0].actorType).toBe("system");
    const after = logs[0].after as any;
    expect(after.reason).toBe(REASON);
    expect(after.approvedByUserIds).toEqual([users.board.id, users.compliance.id]);

    const notice = await prisma.notification.findFirst({ where: { recipientUserId: users.target.id, type: "birr_staff.mfa_reset" } });
    expect(notice).not.toBeNull();
  });
});
