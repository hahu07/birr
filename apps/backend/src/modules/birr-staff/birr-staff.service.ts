import { EmailField, SecretField } from "../../common/validation/fields";
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { prisma, Prisma, BirrStaffRole } from "@birr/db";
import { verifyUserPassword } from "../../common/auth/password-auth";
import { EncryptionService } from "../../common/settings/encryption.service";
import { MfaService } from "../../common/auth/mfa.service";
import { staffAccessKeys } from "../../common/auth/staff-permissions";
import { ROLE_NAMES, roleNames } from "../../common/auth/staff-roles";

export class BirrStaffLoginInput {
  @EmailField()
  email!: string;

  @SecretField()
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
  // When they last signed in (2026-11-16), so dormant accounts show.
  lastSignInAt: true,
} as const;

/** Governed staff actions, by key, as the Team page names them. */
const STAFF_ACTION_KEYS = ["staff.invite", "staff.role_add", "staff.role_remove", "staff.mfa_reset", "staff.suspend", "staff.reinstate"];

// API shape: `roles` as a plain list (["legal_adviser", ...]) rather than
// the join rows Prisma loads.
function withRoleNames<T extends { roles: { role: BirrStaffRole }[] }>(staff: T): Omit<T, "roles"> & { roles: BirrStaffRole[] } {
  return { ...staff, roles: roleNames(staff) };
}

@Injectable()
export class BirrStaffService {
  constructor(
    private readonly encryption: EncryptionService,
    private readonly mfa: MfaService,
  ) {}

  async findById(id: string) {
    const staff = await prisma.birrStaff.findUnique({ where: { id }, include: { user: { select: SAFE_USER_SELECT }, ...ROLE_NAMES } });
    return staff && withRoleNames(staff);
  }

  async list() {
    const staff = await prisma.birrStaff.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: SAFE_USER_SELECT }, ...ROLE_NAMES },
    });
    return staff.map(withRoleNames);
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
  /** Records a finished sign-in to the Ops Console (2026-11-16). */
  async recordSignIn(userId: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { lastSignInAt: new Date() } });
  }

  /**
   * Every governed staff action about one person, newest first: the
   * invitation that brought them in (matched by email) and each role
   * change, suspension, reinstatement and two-factor reset, with its
   * reason, who proposed it and who decided (2026-11-16). Null when the
   * person doesn't exist.
   */
  async history(staffId: string) {
    const staff = await prisma.birrStaff.findUnique({ where: { id: staffId }, include: { user: { select: { email: true } } } });
    if (!staff) return null;
    // An invitation's payload keeps the email as it was typed, so match it
    // without regard to letter case.
    const invites = await prisma.$queryRaw<{ id: string }[]>`
      SELECT ga.id FROM governed_actions ga JOIN permissions p ON p.id = ga."permissionId"
      WHERE p.key = 'staff.invite' AND lower(ga.payload->>'email') = lower(${staff.user.email})`;
    const actions = await prisma.governedAction.findMany({
      where: {
        permission: { key: { in: STAFF_ACTION_KEYS } },
        OR: [{ payload: { path: ["staffId"], equals: staffId } }, { id: { in: invites.map((i) => i.id) } }],
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: this.actionSelect,
    });
    return actions.map((a) => this.presentAction(a));
  }

  /** Staff changes awaiting approval, so the Team page can mark who's affected. */
  async pendingChanges() {
    const actions = await prisma.governedAction.findMany({
      where: { status: "proposed", permission: { key: { in: STAFF_ACTION_KEYS } } },
      orderBy: { createdAt: "desc" },
      select: this.actionSelect,
    });
    return actions.map((a) => this.presentAction(a));
  }

  private readonly actionSelect = {
    id: true,
    status: true,
    payload: true,
    createdAt: true,
    decidedAt: true,
    permission: { select: { key: true } },
    makerUser: { select: { fullName: true } },
    checkerUser: { select: { fullName: true } },
  } as const;

  private presentAction(a: {
    id: string;
    status: string;
    payload: unknown;
    createdAt: Date;
    decidedAt: Date | null;
    permission: { key: string };
    makerUser: { fullName: string } | null;
    checkerUser: { fullName: string } | null;
  }) {
    const payload = (a.payload ?? {}) as { staffId?: string; email?: string; role?: string; staffRole?: string; reason?: string };
    return {
      id: a.id,
      kind: a.permission.key.replace(/^staff\./, ""),
      status: a.status,
      staffId: payload.staffId ?? null,
      email: payload.email?.trim().toLowerCase() ?? null,
      role: payload.role ?? payload.staffRole ?? null,
      reason: payload.reason?.trim() || null,
      proposedBy: a.makerUser?.fullName ?? null,
      decidedBy: a.checkerUser?.fullName ?? null,
      proposedAt: a.createdAt,
      decidedAt: a.decidedAt,
    };
  }

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
   * Re-callable: starting again returns the same unconfirmed secret
   * (and QR code), so an earlier scan still works.
   */
  async startMfaEnrollment(userId: string): Promise<{ qrCodeDataUrl: string; secretForManualEntry: string }> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // Starting again must never replace a secret already in use: the
    // person would be locked out at their next sign-in.
    if (user.mfaEnabled) {
      throw new BadRequestException("Two-factor authentication is already on for this account.");
    }
    // An unconfirmed secret is reused, not replaced, so a second tab or a
    // return to this page shows the same QR code and every code from it
    // keeps working. A reset clears the secret, which starts afresh.
    const pending = user.mfaSecretEncrypted ? this.encryption.decrypt(user.mfaSecretEncrypted) : undefined;
    const { secretBase32, otpauthUri } = this.mfa.generateSecret(user.email, pending);
    if (!pending) {
      // Only if still unset: two first calls at once both end up with the winner's secret.
      await prisma.user.updateMany({
        where: { id: userId, mfaSecretEncrypted: null, mfaEnabled: false },
        data: { mfaSecretEncrypted: this.encryption.encrypt(secretBase32) },
      });
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      if (stored.mfaSecretEncrypted && this.encryption.decrypt(stored.mfaSecretEncrypted) !== secretBase32) {
        return this.startMfaEnrollment(userId);
      }
    }
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
    return { userId: staff.userId, fullName: staff.user.fullName };
  }

  /** GET /birr-staff/me — session bootstrap for the Ops Console. */
  async getSessionSummary(userId: string) {
    const staff = withRoleNames(
      await prisma.birrStaff.findUniqueOrThrow({
        where: { userId },
        include: { user: { select: SAFE_USER_SELECT }, ...ROLE_NAMES },
      }),
    );
    // Every permission any of this person's roles holds, so the Ops
    // Console can show or hide controls without hard-coding role names.
    // The backend guards remain the real boundary.
    return { ...staff, permissions: await staffAccessKeys(staff) };
  }
}
