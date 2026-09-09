import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import { hash, compare } from "bcryptjs";
import { IsEnum, IsOptional, IsString, Matches, MinLength } from "class-validator";
import { prisma, FounderKind, InstitutionType } from "@birr/db";
import { assertUserEmailVerified, assertUserWhatsAppVerified } from "../../common/auth/current-founder";
import { ResendVerificationEmailAdapter } from "./email/resend.adapter";
import { LogoStorageService } from "../foundations/logo-storage.service";
import { EncryptionService } from "../../common/settings/encryption.service";
import { MfaService } from "../../common/auth/mfa.service";

const MIN_PASSWORD_LENGTH = 8;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;

export class CreateFounderInput {
  @IsString()
  name!: string;

  @IsEnum(FounderKind)
  kind!: FounderKind;

  @IsOptional()
  @IsEnum(InstitutionType)
  institutionType?: InstitutionType;

  @IsOptional()
  @IsString()
  homeJurisdiction?: string;
}

export class SignUpInput {
  @IsString()
  fullName!: string;

  @IsString()
  email!: string;

  @Matches(USERNAME_PATTERN, {
    message: "Username must be 3-32 characters: letters, numbers, underscore, period, or hyphen.",
  })
  username!: string;

  @MinLength(MIN_PASSWORD_LENGTH)
  password!: string;
}

export class LoginInput {
  @IsString()
  username!: string;

  @IsString()
  password!: string;
}

export class EstablishFounderAndFoundationInput {
  @IsString()
  founderName!: string;

  @IsEnum(FounderKind)
  kind!: FounderKind;

  @IsOptional()
  @IsEnum(InstitutionType)
  institutionType?: InstitutionType;

  @IsOptional()
  @IsString()
  homeJurisdiction?: string;

  @IsString()
  foundationName!: string;

  @IsString()
  purpose!: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;
}

// Step 2's own fields, minus the ones Rafiq has no use for (logo) —
// whatever the Founder has already typed by the time they ask for help.
export class DraftPurposeSuggestionInput {
  @IsString()
  founderName!: string;

  @IsEnum(FounderKind)
  kind!: FounderKind;

  @IsOptional()
  @IsEnum(InstitutionType)
  institutionType?: InstitutionType;

  @IsString()
  foundationName!: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;
}

const VERIFICATION_TOKEN_VALIDITY_HOURS = 24;
const BCRYPT_ROUNDS = 10;

@Injectable()
export class FoundersService {
  private readonly logger = new Logger(FoundersService.name);

  constructor(
    private readonly emailAdapter: ResendVerificationEmailAdapter,
    private readonly logoStorage: LogoStorageService,
    private readonly encryption: EncryptionService,
    private readonly mfa: MfaService,
  ) {}

  // Bootstrap-scope note: this route is intentionally unauthenticated in
  // this slice (see PermissionGuard) — there's no BirrStaff to gate on yet
  // when the first accounts are being created. Lock down once real auth
  // (WorkOS/Auth0) exists. Used by seed data and tests; the real
  // self-service path is signUp() + establishFounderAndFoundation() below.
  async create(input: CreateFounderInput) {
    return prisma.$transaction(async (tx) => {
      const founder = await tx.founder.create({ data: input });
      await tx.auditLog.create({
        data: {
          actorType: "system",
          action: "founder.created",
          entityType: "Founder",
          entityId: founder.id,
          after: founder as any,
        },
      });
      return founder;
    });
  }

  findById(id: string) {
    return prisma.founder.findUnique({ where: { id } });
  }

  list() {
    return prisma.founder.findMany({ orderBy: { createdAt: "desc" } });
  }

  /**
   * Real, first-time account creation — identity + credentials only.
   * Founder/Foundation establishment is a separate later step
   * (establishFounderAndFoundation) once email + WhatsApp are verified,
   * not bundled in here — see this module's own comments on why the
   * session is User-keyed, not Founder-keyed. The controller mints a
   * session cookie immediately after this succeeds, so signing up also
   * logs the user in.
   */
  async signUp(input: SignUpInput) {
    // Also enforced by SignUpInput's own decorators (class-validator,
    // global ValidationPipe) for any real HTTP request — repeated here
    // as defense-in-depth for direct callers of this method (this
    // codebase's own established pattern: see e.g. the app-layer
    // maker≠checker check in governed-actions.service.ts, which
    // exists alongside the DB constraint that's the actual guarantee).
    if (!USERNAME_PATTERN.test(input.username)) {
      throw new BadRequestException(
        "Username must be 3-32 characters: letters, numbers, underscore, period, or hyphen.",
      );
    }
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const existingEmail = await prisma.user.findUnique({ where: { email: input.email } });
    if (existingEmail) {
      throw new ConflictException(`An account already exists for "${input.email}".`);
    }
    const existingUsername = await prisma.user.findUnique({ where: { username: input.username } });
    if (existingUsername) {
      throw new ConflictException(`Username "${input.username}" is already taken.`);
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_VALIDITY_HOURS * 60 * 60 * 1000);
    const passwordHash = await hash(input.password, BCRYPT_ROUNDS);

    const user = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          username: input.username,
          passwordHash,
          verificationToken: token,
          verificationTokenExpiresAt: expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "founder_user",
          actorUserId: user.id,
          action: "user.signed_up",
          entityType: "User",
          entityId: user.id,
          after: { id: user.id, email: user.email, fullName: user.fullName, username: user.username } as any,
        },
      });
      return user;
    });

    const verifyLink = `${process.env.BACKEND_URL ?? "http://localhost:4000"}/founders/verify-email?token=${token}`;
    // Best-effort, outside the DB transaction — same posture as every
    // other side-channel send in this codebase (InvitationsService.invite(),
    // NotificationsService.notify()): a Resend outage must never turn a
    // successfully created account into an error response. This used to
    // throw here, which meant the controller's setSessionCookie() below
    // never ran and the founder was left with a real, unverified account
    // but no session and no way to request a new link — signing up again
    // just hit "an account already exists." resendVerificationEmail()
    // below is the real fix for "the email didn't arrive," not this path.
    let emailSent = false;
    try {
      await this.emailAdapter.sendVerificationEmail(user.email, verifyLink);
      emailSent = true;
    } catch (err) {
      this.logger.error(`Couldn't send verification email to ${user.email}:`, err instanceof Error ? err.message : err);
    }

    return { userId: user.id, emailSent };
  }

  /**
   * The other half of the signUp() fix above — lets a founder whose
   * verification email never arrived (Resend outage, spam filter, a
   * stale/expired link) get a new one without needing a whole new
   * account. Requires a session because signUp() always logs the
   * founder in immediately regardless of email delivery — there's no
   * unauthenticated identifier to resend to that wouldn't leak whether
   * an email address has an account.
   */
  async resendVerificationEmail(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status === "active") {
      throw new BadRequestException("This email is already verified.");
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_VALIDITY_HOURS * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: userId },
      data: { verificationToken: token, verificationTokenExpiresAt: expiresAt },
    });

    const verifyLink = `${process.env.BACKEND_URL ?? "http://localhost:4000"}/founders/verify-email?token=${token}`;
    try {
      await this.emailAdapter.sendVerificationEmail(user.email, verifyLink);
    } catch (err) {
      throw new BadRequestException(
        `Couldn't send the verification email: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }

    return { ok: true };
  }

  // Accepts either the self-service username picked at sign-up, or an
  // email — an invited founder_user (InvitationsService.accept()) never
  // goes through signUp() and so never gets a username at all
  // (User.username stays null), and email is the only identifier they
  // have. Self-service founders keep logging in with their username
  // exactly as before; the OR just adds a second way in, never removes
  // the first.
  async login(input: LoginInput) {
    const user = await prisma.user.findFirst({
      where: { OR: [{ username: input.username }, { email: input.username }] },
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException("Incorrect username or password.");
    }
    const matches = await compare(input.password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException("Incorrect username or password.");
    }
    if (user.status === "suspended") {
      throw new UnauthorizedException("This account has been suspended.");
    }
    // Opt-in, unlike birr_staff — mfaEnabled: false just means the
    // caller (FoundersController.login) issues the real session
    // directly, same as before this existed. See account/page.tsx's own
    // comment on why nothing here forces enrollment.
    return { userId: user.id, mfaEnabled: user.mfaEnabled };
  }

  /**
   * The second step of login for a Founder who's opted into MFA —
   * called with the userId recovered from the short-lived
   * founder-MFA-pending cookie (see session.ts), never client input
   * directly. Identical logic to BirrStaffService.verifyLoginMfaCode —
   * TOTP first, then an unused single-use backup code.
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
   * Starts (or restarts) enrollment — a Founder's own choice, from
   * their Account page, always while already fully signed in (unlike
   * staff's forced pre-session enrollment, there's no exempt-route
   * state to design around here). Doesn't flip mfaEnabled until
   * confirmMfaEnrollment succeeds.
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

  /** Confirms enrollment — same shape as BirrStaffService.confirmMfaEnrollment, audit-logged as founder.mfa_enabled instead of birr_staff.mfa_enabled. */
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
          actorType: "founder_user",
          actorUserId: userId,
          action: "founder.mfa_enabled",
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
   * platform_admin-only break-glass path — a Founder who loses both
   * their device and their backup codes has no self-service recovery
   * (MFA has no self-service disable, same reasoning as the staff
   * side). Clears MFA state entirely; doesn't touch password or status.
   */
  async resetMfa(userId: string, actorStaffUserId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User "${userId}" not found.`);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { mfaEnabled: false, mfaSecretEncrypted: null },
      });
      await tx.mfaBackupCode.deleteMany({ where: { userId } });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId: actorStaffUserId,
          action: "founder.mfa_reset",
          entityType: "User",
          entityId: userId,
          before: { mfaEnabled: user.mfaEnabled } as any,
          after: { mfaEnabled: false } as any,
        },
      });
    });
    return { ok: true };
  }

  async verifyEmail(token: string) {
    const user = await prisma.user.findUnique({ where: { verificationToken: token } });
    if (!user) {
      throw new NotFoundException("Invalid or already-used verification link.");
    }
    if (!user.verificationTokenExpiresAt || user.verificationTokenExpiresAt < new Date()) {
      throw new BadRequestException("This verification link has expired.");
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { status: "active", verificationToken: null, verificationTokenExpiresAt: null },
      });
      await tx.auditLog.create({
        data: {
          actorType: "founder_user",
          actorUserId: user.id,
          action: "user.email_verified",
          entityType: "User",
          entityId: user.id,
        },
      });
    });

    return { userId: user.id };
  }

  /**
   * Step 2 of onboarding, and the merge point the user asked for: what
   * used to be sign-up's identity fields (Founder name/kind/institution
   * type/home jurisdiction) plus Foundation establishment plus an
   * optional logo, submitted together, atomically, for a user who
   * doesn't have a Founder yet. This is now the only path that creates a
   * Founder through the real self-service flow — create() above stays
   * unauthenticated bootstrap/seed-only CRUD.
   */
  async establishFounderAndFoundation(
    userId: string,
    input: EstablishFounderAndFoundationInput,
    logoFile?: Express.Multer.File,
  ) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assertUserEmailVerified(user);
    assertUserWhatsAppVerified(user);

    const existing = await prisma.founderMembership.findFirst({
      where: { userId, permissionLevel: "primary_contact" },
    });
    if (existing) {
      throw new ConflictException("You've already established a Founder account.");
    }
    if (!input.purpose?.trim()) {
      throw new BadRequestException("purpose is required.");
    }

    // Saved before the transaction — a filesystem write can't
    // participate in a Postgres transaction anyway, and validating the
    // file (mimetype/size) before touching the DB is the right order.
    const logo = logoFile ? await this.logoStorage.saveLogo(logoFile) : null;

    return prisma.$transaction(async (tx) => {
      const founder = await tx.founder.create({
        data: {
          name: input.founderName,
          kind: input.kind,
          institutionType: input.institutionType,
          homeJurisdiction: input.homeJurisdiction,
        },
      });
      await tx.founderMembership.create({
        data: { founderId: founder.id, userId, permissionLevel: "primary_contact" },
      });
      await tx.auditLog.create({
        data: {
          actorType: "founder_user",
          actorUserId: userId,
          actorFounderId: founder.id,
          action: "founder.created",
          entityType: "Founder",
          entityId: founder.id,
          after: founder as any,
        },
      });

      const foundation = await tx.foundation.create({
        data: {
          name: input.foundationName,
          purpose: input.purpose,
          jurisdiction: input.jurisdiction,
          logoUrl: logo?.url,
        },
      });
      await tx.foundationFounder.create({ data: { foundationId: foundation.id, founderId: founder.id } });
      await tx.auditLog.create({
        data: {
          actorType: "founder_user",
          actorUserId: userId,
          actorFounderId: founder.id,
          action: "foundation.created",
          entityType: "Foundation",
          entityId: foundation.id,
          after: foundation as any,
        },
      });

      return { founder, foundation };
    });
  }

  /**
   * POST /founders/onboarding/purpose-suggestion — Rafiq, invoked on
   * demand rather than through the ai_agents API-key path the scheduled
   * agents use (see services/agents/src/server.ts's own comment on why
   * this shape is different). The backend calls out to the agent
   * service directly and records the draft itself — there's no round
   * trip through POST /ai-agents/:name/drafts here, since the backend is
   * already the one making the call, not an external agent
   * authenticating in. No Foundation exists yet at this point in
   * onboarding, so the audit entry is User-keyed rather than
   * Foundation-keyed — the closest real entity that exists right now.
   */
  async draftPurposeSuggestion(userId: string, input: DraftPurposeSuggestionInput) {
    const agentServiceUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:4100";
    const internalKey = process.env.AGENT_SERVICE_INTERNAL_KEY;
    if (!internalKey) {
      throw new Error("AGENT_SERVICE_INTERNAL_KEY is not configured.");
    }

    const res = await fetch(`${agentServiceUrl}/rafiq/draft-help`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": internalKey },
      body: JSON.stringify(input),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new BadRequestException(body?.message ?? "Rafiq couldn't draft a suggestion right now.");
    }

    const rafiqAgent = await prisma.aiAgent.findUnique({ where: { name: "rafiq" } });
    await prisma.auditLog.create({
      data: {
        actorType: "ai_agent",
        actorAgentId: rafiqAgent?.id,
        action: "onboarding_assist.drafted",
        entityType: "User",
        entityId: userId,
        after: { input, suggestedPurpose: body.suggestedPurpose } as any,
      },
    });

    return { suggestedPurpose: body.suggestedPurpose as string };
  }

  /**
   * GET /founders/me — session bootstrap for the frontend. Any active
   * membership, not just primary_contact — see
   * resolveFounderFromSession's own comment on why that restriction
   * would leave an invited viewer/requester colleague looking like they
   * have no Foundation at all.
   */
  async getSessionSummary(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const membership = await prisma.founderMembership.findFirst({
      where: { userId, status: "active" },
      include: { founder: true },
    });
    return {
      user: { id: user.id, email: user.email, fullName: user.fullName, mfaEnabled: user.mfaEnabled },
      founder: membership?.founder ?? null,
    };
  }

  /**
   * GET /founders/me/members — a Founder's own view of who else has
   * access to their Foundation (all statuses, so a revoked colleague
   * still shows with that status rather than vanishing). Any active
   * member can see this list — it's who has access, not a sensitive
   * admin-only fact — but only the primary contact can invite or revoke
   * (see InvitationsController's assertPrimaryContact checks).
   */
  listMembers(founderId: string) {
    return prisma.founderMembership.findMany({
      where: { founderId },
      include: { user: { select: { id: true, fullName: true, email: true, mfaEnabled: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Pure read, computed live from ground truth every call — never a
   * cached/stored "current step" field. This endpoint exists only to
   * drive the frontend wizard's UX; every write path it describes
   * (WhatsAppVerificationService, establishFounderAndFoundation above,
   * WaqfsService, ContributionsService, WaqfDeedsService) independently
   * re-derives its own prerequisite from these same rows, never from
   * this method's output. User-keyed, not Founder-keyed — a Founder may
   * not exist yet (steps 1-2).
   *
   * Any active membership, not just primary_contact — an invited
   * viewer/requester colleague has their own User row but never goes
   * through steps 1-2 themselves (the invitation is what vouches for
   * them, same posture as an invited BirrStaff member). See the
   * currentStep gate below for how their email/WhatsApp verification
   * state is kept from blocking them on an org that's already onboarded.
   */
  async getOnboardingStatus(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const emailVerified = user.status === "active";
    const whatsappVerified = user.whatsappVerifiedAt !== null;

    const membership = await prisma.founderMembership.findFirst({
      where: { userId, status: "active" },
    });
    const founderId = membership?.founderId ?? null;

    const firstFoundation = founderId
      ? await prisma.foundation.findFirst({
          where: { foundationFounders: { some: { founderId } } },
          orderBy: { createdAt: "asc" },
          include: { foundationDeed: true },
        })
      : null;

    // "The founder's first Waqf" — earliest-created across any of their
    // Foundations. Safe to treat as singular because the gate is strict:
    // a founder can't create a second Foundation/Waqf before finishing
    // onboarding, so nothing else could exist yet to confuse this.
    const firstWaqf =
      founderId && firstFoundation
        ? await prisma.waqf.findFirst({
            where: { foundation: { foundationFounders: { some: { founderId } } } },
            orderBy: { createdAt: "asc" },
            include: {
              contributions: { where: { status: "confirmed" }, take: 1 },
            },
          })
        : null;

    const firstWaqfFunded = firstWaqf?.status === "active";
    // Deed-signing is Foundation-level, not per-Waqf — see
    // FoundationDeed's own schema comment for why this superseded the
    // original per-Waqf design.
    const deedSigned = Boolean(firstFoundation?.foundationDeed);

    // Steps 1-2 (email/WhatsApp verification, then establishing the
    // Founder + Foundation) are about a person with no membership yet —
    // once founderId exists, the org itself is past that point, whether
    // this particular user got there by doing steps 1-2 themselves or by
    // being invited into an org that already had. Gating on *this*
    // user's own emailVerified/whatsappVerified past that point would
    // wrongly send an invited colleague back into onboarding for
    // something the invitation already vouched for.
    let currentStep: 1 | 2 | 3 | 4 | "done";
    if (!founderId) currentStep = !emailVerified || !whatsappVerified ? 1 : 2;
    else if (!firstWaqfFunded) currentStep = 3;
    else if (!deedSigned) currentStep = 4;
    else currentStep = "done";

    return {
      userId,
      founderId,
      steps: {
        emailVerified: { complete: emailVerified, completedAt: null },
        whatsappVerified: {
          complete: whatsappVerified,
          completedAt: user.whatsappVerifiedAt?.toISOString() ?? null,
        },
        foundationEstablished: { complete: Boolean(firstFoundation), foundationId: firstFoundation?.id ?? null },
        firstWaqfFunded: {
          complete: firstWaqfFunded,
          waqfId: firstWaqf?.id ?? null,
          contributionId: firstWaqf?.contributions[0]?.id ?? null,
        },
        deedSigned: {
          complete: deedSigned,
          foundationId: firstFoundation?.id ?? null,
          signedAt: firstFoundation?.foundationDeed?.signedAt.toISOString() ?? null,
        },
      },
      currentStep,
      onboardingComplete: currentStep === "done",
    };
  }
}
