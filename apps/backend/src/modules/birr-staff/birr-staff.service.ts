import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { IsEmail, IsEnum, IsString } from "class-validator";
import { prisma, Prisma, BirrStaffRole } from "@birr/db";
import { verifyUserPassword } from "../../common/auth/password-auth";
import { EncryptionService } from "../../common/settings/encryption.service";
import { MfaService } from "../../common/auth/mfa.service";

export class CreateBirrStaffInput {
  @IsEmail()
  email!: string;

  @IsString()
  fullName!: string;

  @IsEnum(BirrStaffRole)
  staffRole!: BirrStaffRole;
}

export class BirrStaffLoginInput {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

// Never select passwordHash (or the email-verification token) onto a
// response body — findById/list/getSessionSummary all nest the User
// record for display purposes only, not to hand the client someone's
// credential material back. Same principle as
// FoundersService.getSessionSummary's explicit field pick.
const SAFE_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  status: true,
  mfaEnabled: true,
  // Self-facing only (getSessionSummary is always "my own record") — a
  // staff member's own WhatsApp verification state, needed by the
  // profile page's request-OTP/verify-OTP form (see
  // BirrStaffWhatsAppService) to know whether to show "verified" or the
  // capture form. Same posture as FoundersService exposing the founder
  // equivalent via its own onboarding-status endpoint.
  whatsappNumber: true,
  whatsappVerifiedAt: true,
} as const;

@Injectable()
export class BirrStaffService {
  constructor(
    private readonly encryption: EncryptionService,
    private readonly mfa: MfaService,
  ) {}

  // Gated to platform_admin at the controller (@RequiresStaffRole) —
  // real staff onboarding goes through InvitationsService.accept(),
  // which sets a password and logs the invitee straight in. This method
  // stays for admin/scripted bootstrap use (e.g. minting the very first
  // platform_admin), so it deliberately doesn't set a password; a staff
  // record created this way can't log in via /birr-staff/login until an
  // Invitation-based flow or a future "set password" route covers it.
  //
  // No standalone Users module exists yet (CLAUDE.md lists `users` as
  // entity #1, but nothing in apps/backend owns it directly) — creating a
  // BirrStaff member inherently provisions the underlying User account in
  // the same transaction, since BirrStaff.userId is a required unique FK.
  async create(input: CreateBirrStaffInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, fullName: input.fullName },
      });
      const staff = await tx.birrStaff.create({
        data: { userId: user.id, staffRole: input.staffRole },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "birr_staff.created",
          entityType: "BirrStaff",
          entityId: staff.id,
          after: staff as any,
        },
      });
      return staff;
    });
  }

  findById(id: string) {
    return prisma.birrStaff.findUnique({ where: { id }, include: { user: { select: SAFE_USER_SELECT } } });
  }

  list() {
    return prisma.birrStaff.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: SAFE_USER_SELECT } },
    });
  }

  async login(input: BirrStaffLoginInput) {
    const user = await verifyUserPassword(input.email, input.password);
    const staff = await prisma.birrStaff.findUnique({ where: { userId: user.id } });
    if (!staff || staff.status !== "active") {
      throw new NotFoundException("No active Birr staff account for this user.");
    }
    // mfaEnabled: false doesn't mean "skip MFA" — it means the caller
    // (BirrStaffController.login) issues a real session anyway, and
    // SessionAuthGuard then blocks everything except enrollment until
    // it's set up. See that guard's own comment — MFA is mandatory, not
    // opt-in.
    return { userId: user.id, mfaEnabled: user.mfaEnabled };
  }

  /**
   * The second step of login for an mfaEnabled account — called with
   * the userId recovered from the short-lived MFA-pending cookie (see
   * session.ts), never from client input directly. Tries a TOTP code
   * first, then falls back to an unused backup code (single-use,
   * consumed on match) — see MfaBackupCode's own schema comment on why
   * that recovery path exists at all given MFA has no self-service
   * disable.
   */
  async verifyLoginMfaCode(userId: string, code: string): Promise<void> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabled || !user.mfaSecretEncrypted) {
      throw new BadRequestException("MFA is not enabled for this account.");
    }
    const secret = this.encryption.decrypt(user.mfaSecretEncrypted);
    if (this.mfa.verifyCode(secret, code)) return;

    const unusedCodes = await prisma.mfaBackupCode.findMany({ where: { userId, usedAt: null } });
    for (const candidate of unusedCodes) {
      if (await this.mfa.compareBackupCode(code, candidate.codeHash)) {
        await prisma.mfaBackupCode.update({ where: { id: candidate.id }, data: { usedAt: new Date() } });
        return;
      }
    }
    throw new UnauthorizedException("Incorrect code.");
  }

  /**
   * Starts (or restarts) enrollment — generates a fresh secret and
   * stores it encrypted, but doesn't flip mfaEnabled yet (see
   * User.mfaSecretEncrypted's own comment: inert until confirmed).
   * Re-callable: a staff member who scans the QR then closes the tab
   * can just start again, overwriting the unconfirmed secret.
   */
  async startMfaEnrollment(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { secretBase32, otpauthUri } = this.mfa.generateSecret(user.email);
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecretEncrypted: this.encryption.encrypt(secretBase32) },
    });
    const qrCodeDataUrl = await this.mfa.qrCodeDataUrl(otpauthUri);
    return { qrCodeDataUrl, secretForManualEntry: secretBase32 };
  }

  /**
   * Confirms enrollment: verifies the code actually matches the pending
   * secret, then in one transaction enables MFA and issues backup
   * codes. Returns the plaintext codes — the only time they're ever
   * available; only their bcrypt hash is persisted (MfaBackupCode.codeHash).
   */
  async confirmMfaEnrollment(userId: string, code: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaSecretEncrypted) {
      throw new BadRequestException("Start enrollment before confirming it.");
    }
    const secret = this.encryption.decrypt(user.mfaSecretEncrypted);
    if (!this.mfa.verifyCode(secret, code)) {
      throw new BadRequestException("Incorrect code — check your authenticator app and try again.");
    }

    const backupCodes = this.mfa.generateBackupCodes();
    const hashedCodes = await this.mfa.hashBackupCodes(backupCodes);

    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
      await tx.mfaBackupCode.createMany({
        data: hashedCodes.map((codeHash) => ({ userId, codeHash })),
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId: userId,
          action: "birr_staff.mfa_enabled",
          entityType: "User",
          entityId: userId,
          before: { mfaEnabled: user.mfaEnabled } as any,
          after: { mfaEnabled: updated.mfaEnabled } as any,
        },
      });
    });

    return { backupCodes };
  }

  /**
   * Clears a staff member's MFA state entirely and forces re-enrolment on
   * their next sign-in; doesn't touch their password or status.
   *
   * Internal only — there is deliberately no controller route for this
   * any more. It used to be a single Platform Admin's unilateral
   * break-glass action; now the only caller is GovernedActionsService's
   * `staff.mfa_reset` handler, on approval, inside its own transaction —
   * so a second, different person (Board or Compliance) has always signed
   * off. The audit record is written by that engine from the returned
   * before/after, not here. For a lone locked-out Platform Admin with
   * nobody to propose it, see emergency-mfa-reset.ts and
   * docs/staff-mfa-recovery.md.
   */
  async resetMfaInTransaction(staffId: string, tx: Prisma.TransactionClient) {
    const staff = await tx.birrStaff.findUnique({ where: { id: staffId }, include: { user: true } });
    if (!staff) throw new NotFoundException(`BirrStaff "${staffId}" not found.`);
    if (!staff.user.mfaEnabled) {
      throw new BadRequestException(`${staff.user.fullName} has no two-factor authentication enrolled — nothing to reset.`);
    }
    await tx.user.update({ where: { id: staff.userId }, data: { mfaEnabled: false, mfaSecretEncrypted: null } });
    await tx.mfaBackupCode.deleteMany({ where: { userId: staff.userId } });
    return { userId: staff.userId, fullName: staff.user.fullName, staffRole: staff.staffRole };
  }

  /** GET /birr-staff/me — session bootstrap for the Ops Console. */
  async getSessionSummary(userId: string) {
    const staff = await prisma.birrStaff.findUniqueOrThrow({
      where: { userId },
      include: { user: { select: SAFE_USER_SELECT } },
    });
    return staff;
  }
}
