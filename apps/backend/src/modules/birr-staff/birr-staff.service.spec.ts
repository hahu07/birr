import { prisma } from "@birr/db";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import * as OTPAuth from "otpauth";
import { BirrStaffService } from "./birr-staff.service";
import { EncryptionService } from "../../common/settings/encryption.service";
import { MfaService } from "../../common/auth/mfa.service";

function codeFor(secretBase32: string): string {
  return new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  }).generate();
}

describe("BirrStaffService", () => {
  const service = new BirrStaffService(new EncryptionService(), new MfaService());

  const staffIds: string[] = [];
  let actorUserId: string;

  beforeAll(async () => {
    // Same requirement as any other spec exercising EncryptionService
    // (see encryption.service.spec.ts's own fixture setup) — needed here
    // for the MFA enrollment tests below, which encrypt/decrypt a real
    // TOTP secret.
    if (!process.env.SETTINGS_ENCRYPTION_KEY) {
      process.env.SETTINGS_ENCRYPTION_KEY = "0".repeat(64);
    }

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

  describe("MFA", () => {
    let mfaUserId: string;
    let mfaStaffId: string;

    beforeAll(async () => {
      const user = await prisma.user.create({
        data: { email: `birr-staff-mfa-${Date.now()}@example.com`, fullName: "MFA Fixture Staff" },
      });
      mfaUserId = user.id;
      const staff = await prisma.birrStaff.create({
        data: { userId: user.id, staffRole: "compliance_officer" },
      });
      mfaStaffId = staff.id;
    });

    test("confirmMfaEnrollment() rejects a code that doesn't match the pending secret", async () => {
      await service.startMfaEnrollment(mfaUserId);
      await expect(service.confirmMfaEnrollment(mfaUserId, "000000")).rejects.toThrow(BadRequestException);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: mfaUserId } });
      expect(user.mfaEnabled).toBe(false);
    });

    test("confirmMfaEnrollment() rejects confirming before enrollment has started", async () => {
      const user = await prisma.user.create({
        data: { email: `birr-staff-mfa-unstarted-${Date.now()}@example.com`, fullName: "Unstarted MFA" },
      });
      await expect(service.confirmMfaEnrollment(user.id, "123456")).rejects.toThrow(BadRequestException);
    });

    // Explicit timeout: bcrypt-hashing 10 backup codes plus QR generation
    // comfortably exceeds Jest's 5s default in a loaded/virtualized CI
    // runner, even though none of it is actually hung.
    test("enrollment start -> confirm with a real code enables MFA and issues 10 usable backup codes", async () => {
      const { secretForManualEntry } = await service.startMfaEnrollment(mfaUserId);
      const { backupCodes } = await service.confirmMfaEnrollment(mfaUserId, codeFor(secretForManualEntry));

      expect(backupCodes).toHaveLength(10);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: mfaUserId } });
      expect(user.mfaEnabled).toBe(true);

      const logs = await prisma.auditLog.findMany({ where: { entityId: mfaUserId, action: "birr_staff.mfa_enabled" } });
      expect(logs).toHaveLength(1);

      // Re-fetch the secret the same way login does, to drive
      // verifyLoginMfaCode() below without re-enrolling.
      const secret = secretForManualEntry;

      await expect(service.verifyLoginMfaCode(mfaUserId, codeFor(secret))).resolves.toBeUndefined();
      await expect(service.verifyLoginMfaCode(mfaUserId, "000000")).rejects.toThrow(UnauthorizedException);

      // A backup code works exactly once.
      const backupCode = backupCodes[0]!;
      await expect(service.verifyLoginMfaCode(mfaUserId, backupCode)).resolves.toBeUndefined();
      await expect(service.verifyLoginMfaCode(mfaUserId, backupCode)).rejects.toThrow(UnauthorizedException);
    }, 15000);

    test("resetMfa() clears MFA state, deletes backup codes, and is audit-logged", async () => {
      const { secretForManualEntry } = await service.startMfaEnrollment(mfaUserId);
      await service.confirmMfaEnrollment(mfaUserId, codeFor(secretForManualEntry));

      await service.resetMfa(mfaStaffId, actorUserId);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: mfaUserId } });
      expect(user.mfaEnabled).toBe(false);
      expect(user.mfaSecretEncrypted).toBeNull();

      const remainingCodes = await prisma.mfaBackupCode.findMany({ where: { userId: mfaUserId } });
      expect(remainingCodes).toHaveLength(0);

      const logs = await prisma.auditLog.findMany({ where: { entityId: mfaUserId, action: "birr_staff.mfa_reset" } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorUserId });
    }, 15000);
  });
});
