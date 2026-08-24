import {
  BadRequestException,
  ConflictException,
  Injectable,
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

const VERIFICATION_TOKEN_VALIDITY_HOURS = 24;
const BCRYPT_ROUNDS = 10;

@Injectable()
export class FoundersService {
  constructor(
    private readonly emailAdapter: ResendVerificationEmailAdapter,
    private readonly logoStorage: LogoStorageService,
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
    // Deliberately outside the DB transaction — the account must exist
    // either way; a delivery failure here shouldn't roll back a
    // successfully created account (the user can request the link be
    // resent later), it should just surface as a 502 for this request.
    try {
      await this.emailAdapter.sendVerificationEmail(user.email, verifyLink);
    } catch (err) {
      throw new BadRequestException(
        `Account created but the verification email could not be sent: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }

    return { userId: user.id };
  }

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({ where: { username: input.username } });
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
    return { userId: user.id };
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

  /** GET /founders/me — session bootstrap for the frontend. */
  async getSessionSummary(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const membership = await prisma.founderMembership.findFirst({
      where: { userId, permissionLevel: "primary_contact" },
      include: { founder: true },
    });
    return {
      user: { id: user.id, email: user.email, fullName: user.fullName },
      founder: membership?.founder ?? null,
    };
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
   */
  async getOnboardingStatus(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const emailVerified = user.status === "active";
    const whatsappVerified = user.whatsappVerifiedAt !== null;

    const membership = await prisma.founderMembership.findFirst({
      where: { userId, permissionLevel: "primary_contact" },
    });
    const founderId = membership?.founderId ?? null;

    const firstFoundation = founderId
      ? await prisma.foundation.findFirst({
          where: { foundationFounders: { some: { founderId } } },
          orderBy: { createdAt: "asc" },
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
              waqfDeed: true,
            },
          })
        : null;

    const firstWaqfFunded = firstWaqf?.status === "active";
    const deedSigned = Boolean(firstWaqf?.waqfDeed);

    let currentStep: 1 | 2 | 3 | 4 | "done";
    if (!emailVerified || !whatsappVerified) currentStep = 1;
    else if (!founderId) currentStep = 2;
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
          waqfId: firstWaqf?.id ?? null,
          signedAt: firstWaqf?.waqfDeed?.signedAt.toISOString() ?? null,
        },
      },
      currentStep,
      onboardingComplete: currentStep === "done",
    };
  }
}
