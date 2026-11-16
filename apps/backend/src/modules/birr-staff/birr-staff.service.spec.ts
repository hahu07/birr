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

  beforeAll(async () => {
    // Same requirement as any other spec exercising EncryptionService
    // (see encryption.service.spec.ts's own fixture setup) — needed here
    // for the MFA enrollment tests below, which encrypt/decrypt a real
    // TOTP secret.
    if (!process.env.SETTINGS_ENCRYPTION_KEY) {
      process.env.SETTINGS_ENCRYPTION_KEY = "0".repeat(64);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("getSessionSummary() reports exactly the permissions the person's role holds", async () => {
    const user = await prisma.user.create({
      data: { email: `birr-staff-summary-${Date.now()}@example.com`, fullName: "Summary Fixture Officer" },
    });
    await prisma.birrStaff.create({ data: { userId: user.id, roles: { create: { role: "mutawalli_officer" } } } });

    const summary = await service.getSessionSummary(user.id);
    // A plain access grant and a governed maker grant are both listed…
    expect(summary.permissions).toEqual(expect.arrayContaining(["vault.curate", "distribution.approve"]));
    // …another role's grants are not.
    expect(summary.permissions).not.toContain("platform_settings.manage");

    // Approving (checker) isn't "can do": the Board approves distributions
    // but doesn't hold distribution.approve as a permission to act on.
    const boardUser = await prisma.user.create({
      data: { email: `birr-staff-summary-board-${Date.now()}@example.com`, fullName: "Summary Fixture Board" },
    });
    await prisma.birrStaff.create({ data: { userId: boardUser.id, roles: { create: { role: "board_of_trustees" } } } });
    expect((await service.getSessionSummary(boardUser.id)).permissions).not.toContain("distribution.approve");
  });

  describe("MFA", () => {
    let mfaUserId: string;

    beforeAll(async () => {
      const user = await prisma.user.create({
        data: { email: `birr-staff-mfa-${Date.now()}@example.com`, fullName: "MFA Fixture Staff" },
      });
      mfaUserId = user.id;
      await prisma.birrStaff.create({
        data: { userId: user.id, roles: { create: { role: "compliance_officer" } } },
      });
    });

    // Explicit timeout: startMfaEnrollment() does real QR PNG generation,
    // which comfortably exceeds Jest's 5s default under a loaded/
    // virtualized runner running this alongside ~50 other test files in
    // parallel — confirmed repeatedly, not a hang. Same reasoning as the
    // other two tests below.
    test(
      "confirmMfaEnrollment() rejects a code that doesn't match the pending secret",
      async () => {
        await service.startMfaEnrollment(mfaUserId);
        await expect(service.confirmMfaEnrollment(mfaUserId, "000000")).rejects.toThrow(BadRequestException);
        const user = await prisma.user.findUniqueOrThrow({ where: { id: mfaUserId } });
        expect(user.mfaEnabled).toBe(false);
      },
      20000,
    );

    test("confirmMfaEnrollment() rejects confirming before enrollment has started", async () => {
      const user = await prisma.user.create({
        data: { email: `birr-staff-mfa-unstarted-${Date.now()}@example.com`, fullName: "Unstarted MFA" },
      });
      await expect(service.confirmMfaEnrollment(user.id, "123456")).rejects.toThrow(BadRequestException);
    });

    // Explicit timeout: bcrypt-hashing 10 backup codes plus QR generation
    // comfortably exceeds Jest's 5s default in a loaded/virtualized CI
    // runner, even though none of it is actually hung. 15000 alone still
    // intermittently timed out under the full backend suite's parallel
    // worker contention — confirmed repeatedly (always passed in
    // isolation) — 25000 gives real headroom instead of guessing again.
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
    }, 25000);

    // Same reasoning as the test above — startMfaEnrollment() + confirmMfaEnrollment()
    // do real QR generation + bcrypt hashing.
    test("resetMfaInTransaction() clears MFA state and deletes backup codes (the audit record is the governed-action engine's job)", async () => {
      const resetUser = await prisma.user.create({ data: { email: `birr-staff-mfa-reset-${Date.now()}@example.com`, fullName: "MFA Reset Staff" } });
      const resetStaff = await prisma.birrStaff.create({ data: { userId: resetUser.id, roles: { create: { role: "compliance_officer" } } } });
      const { secretForManualEntry } = await service.startMfaEnrollment(resetUser.id);
      await service.confirmMfaEnrollment(resetUser.id, codeFor(secretForManualEntry));

      await prisma.$transaction((tx) => service.resetMfaInTransaction(resetStaff.id, tx));

      const user = await prisma.user.findUniqueOrThrow({ where: { id: resetUser.id } });
      expect(user.mfaEnabled).toBe(false);
      expect(user.mfaSecretEncrypted).toBeNull();
      expect(await prisma.mfaBackupCode.count({ where: { userId: resetUser.id } })).toBe(0);
      // After a reset, setup starts afresh with a new secret.
      const again = await service.startMfaEnrollment(resetUser.id);
      expect(again.secretForManualEntry).not.toBe(secretForManualEntry);
    }, 25000);

    test("starting setup again shows the same secret, so an earlier QR code still works; never once two-factor is on", async () => {
      const user = await prisma.user.create({ data: { email: `birr-staff-mfa-restart-${Date.now()}@example.com`, fullName: "MFA Restart Staff" } });
      await prisma.birrStaff.create({ data: { userId: user.id, roles: { create: { role: "compliance_officer" } } } });
      const [first, second] = await Promise.all([service.startMfaEnrollment(user.id), service.startMfaEnrollment(user.id)]);
      expect(second.secretForManualEntry).toBe(first.secretForManualEntry);
      const third = await service.startMfaEnrollment(user.id);
      expect(third.secretForManualEntry).toBe(first.secretForManualEntry);
      // A code from the first QR code confirms setup.
      await service.confirmMfaEnrollment(user.id, codeFor(first.secretForManualEntry));
      await expect(service.startMfaEnrollment(user.id)).rejects.toThrow(/already on/);
      expect(await service.verifyLoginMfaCode(user.id, codeFor(first.secretForManualEntry))).toBeUndefined();
    }, 25000);

    test("resetMfaInTransaction() refuses an account with no MFA enrolled", async () => {
      const user = await prisma.user.create({ data: { email: `birr-staff-mfa-none-${Date.now()}@example.com`, fullName: "No MFA Staff" } });
      const staff = await prisma.birrStaff.create({ data: { userId: user.id, roles: { create: { role: "compliance_officer" } } } });
      await expect(prisma.$transaction((tx) => service.resetMfaInTransaction(staff.id, tx))).rejects.toThrow(
        /nothing to reset/,
      );
    });
  });
});
