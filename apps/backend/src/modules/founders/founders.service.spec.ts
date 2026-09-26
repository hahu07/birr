import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { compare } from "bcryptjs";
import * as OTPAuth from "otpauth";
import { prisma } from "@birr/db";
import { FoundersService } from "./founders.service";
import { ResendVerificationEmailAdapter } from "./email/resend.adapter";
import { LogoStorageService } from "../foundations/logo-storage.service";
import { EncryptionService } from "../../common/settings/encryption.service";
import { MfaService } from "../../common/auth/mfa.service";

// Needed for EncryptionService (MFA secret encryption) below — same
// guard birr-staff.service.spec.ts uses for the same reason.
if (!process.env.SETTINGS_ENCRYPTION_KEY) {
  process.env.SETTINGS_ENCRYPTION_KEY = "0".repeat(64);
}

// Same helper as birr-staff.service.spec.ts's own — computes a real
// TOTP code from a secret so enrollment/login tests can exercise the
// actual verify path, not a mocked one.
function codeFor(secretBase32: string): string {
  return new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  }).generate();
}

// Users can't be deleted in afterAll (audit_logs references them and
// this DB role has UPDATE/DELETE revoked on audit_logs), so every test
// email/username must be unique per test *run*, not just per test, to
// survive a re-run against the same database without colliding with
// leftover rows.
const runId = randomUUID();
const testEmail = (label: string) => `${label}-${runId}@example.test`;
// Truncated to stay within the 32-char username max even for longer
// test labels, with the runId suffix still guaranteeing per-run
// uniqueness.
const testUsername = (label: string) => `${label.replace(/[^a-z0-9]/gi, "").slice(0, 20)}${runId.slice(0, 8)}`;

class FakeEmailAdapter {
  sent: { to: string; link: string }[] = [];
  passwordResetSent: { to: string; link: string }[] = [];
  shouldFail = false;

  async sendVerificationEmail(to: string, link: string): Promise<void> {
    if (this.shouldFail) throw new Error("delivery failed");
    this.sent.push({ to, link });
  }

  async sendPasswordResetEmail(to: string, link: string): Promise<void> {
    if (this.shouldFail) throw new Error("delivery failed");
    this.passwordResetSent.push({ to, link });
  }
}

// Real PNG magic bytes — LogoStorageService.saveLogo now decides the
// allowlist off file content, not the client-supplied mimetype (2026-08-30
// security audit fix), so this fixture needs to actually match.
const REAL_PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

const FAKE_LOGO: Express.Multer.File = {
  fieldname: "logo",
  originalname: "logo.png",
  encoding: "7bit",
  mimetype: "image/png",
  size: REAL_PNG_BYTES.length,
  buffer: REAL_PNG_BYTES,
} as Express.Multer.File;

describe("FoundersService.signUp / login / verifyEmail", () => {
  const emailAdapter = new FakeEmailAdapter();
  const service = new FoundersService(emailAdapter as unknown as ResendVerificationEmailAdapter, new LogoStorageService(), new EncryptionService(), new MfaService());

  afterAll(async () => {
    // Users are left in place, same reasoning as every other spec in
    // this codebase — audit_logs rows reference them (actorUserId), and
    // this DB role has UPDATE/DELETE revoked on audit_logs at the role
    // level (CLAUDE.md non-negotiable), so any cascade through that FK
    // is correctly rejected rather than chased.
    await prisma.$disconnect();
  });

  test("signUp() creates a User (no Founder yet), hashes the password, sends a verification email, and audit-logs the sign-up", async () => {
    const email = testEmail("signup-happy-path");
    const username = testUsername("signuphappypath");

    const { userId } = await service.signUp({
      fullName: "Signup Spec Contact",
      email,
      username,
      password: "correct-horse-battery",
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.status).toBe("invited");
    expect(user?.username).toBe(username);
    expect(user?.verificationToken).toBeTruthy();
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordHash).not.toBe("correct-horse-battery");
    expect(await compare("correct-horse-battery", user!.passwordHash!)).toBe(true);

    const membership = await prisma.founderMembership.findFirst({ where: { userId } });
    expect(membership).toBeNull();

    expect(emailAdapter.sent).toContainEqual(
      expect.objectContaining({ to: email, link: expect.stringContaining(user!.verificationToken!) }),
    );

    const logs = await prisma.auditLog.findMany({ where: { entityId: userId, action: "user.signed_up" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "founder_user", actorUserId: userId });
  });

  test("signUp() rejects a duplicate email with ConflictException", async () => {
    const email = testEmail("signup-duplicate-email");
    await service.signUp({
      fullName: "First Signup",
      email,
      username: testUsername("signupdupemail1"),
      password: "correct-horse-battery",
    });

    await expect(
      service.signUp({
        fullName: "Second Signup",
        email,
        username: testUsername("signupdupemail2"),
        password: "correct-horse-battery",
      }),
    ).rejects.toThrow(ConflictException);
  });

  test("signUp() rejects a duplicate username with ConflictException", async () => {
    const username = testUsername("signupdupuser");
    await service.signUp({
      fullName: "First Signup",
      email: testEmail("signup-duplicate-username-1"),
      username,
      password: "correct-horse-battery",
    });

    await expect(
      service.signUp({
        fullName: "Second Signup",
        email: testEmail("signup-duplicate-username-2"),
        username,
        password: "correct-horse-battery",
      }),
    ).rejects.toThrow(ConflictException);
  });

  test("signUp() rejects a short password", async () => {
    await expect(
      service.signUp({
        fullName: "Weak Password",
        email: testEmail("signup-weak-password"),
        username: testUsername("signupweakpw"),
        password: "short",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test("signUp() rejects an invalid username", async () => {
    await expect(
      service.signUp({
        fullName: "Bad Username",
        email: testEmail("signup-bad-username"),
        username: "a b!",
        password: "correct-horse-battery",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test("signUp() still succeeds (emailSent: false) when email delivery fails — never blocks account creation", async () => {
    const email = testEmail("signup-delivery-fails");
    emailAdapter.shouldFail = true;
    let result: Awaited<ReturnType<typeof service.signUp>>;
    try {
      result = await service.signUp({
        fullName: "Delivery Fails",
        email,
        username: testUsername("signupdeliveryfails"),
        password: "correct-horse-battery",
      });
    } finally {
      emailAdapter.shouldFail = false;
    }

    expect(result.emailSent).toBe(false);

    // The account itself was still created — a delivery failure doesn't
    // roll back a successfully created account, and (unlike before) no
    // longer prevents the controller from logging the founder in either.
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
  });

  test("resendVerificationEmail() sends a fresh link and rejects once already verified", async () => {
    const email = testEmail("resend-verification");
    const { userId } = await service.signUp({
      fullName: "Resend Verification",
      email,
      username: testUsername("resendverification"),
      password: "correct-horse-battery",
    });
    emailAdapter.sent = [];

    await service.resendVerificationEmail(userId);
    expect(emailAdapter.sent).toHaveLength(1);
    expect(emailAdapter.sent[0]?.to).toBe(email);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.verificationToken).not.toBeNull();

    await service.verifyEmail(user!.verificationToken!);

    await expect(service.resendVerificationEmail(userId)).rejects.toThrow(BadRequestException);
  });

  describe("requestPasswordReset() / resetPassword()", () => {
    test("full round trip: request a reset, use the token, log in with the new password", async () => {
      const email = testEmail("password-reset-happy");
      const username = testUsername("pwresethappy");
      await service.signUp({ fullName: "Password Reset Happy Path", email, username, password: "original-password" });
      emailAdapter.passwordResetSent = [];

      await service.requestPasswordReset(email);
      expect(emailAdapter.passwordResetSent).toHaveLength(1);
      expect(emailAdapter.passwordResetSent[0]?.to).toBe(email);

      const link = emailAdapter.passwordResetSent[0]!.link;
      const token = new URL(link).searchParams.get("token")!;
      expect(token).toBeTruthy();

      await service.resetPassword({ token, newPassword: "brand-new-password" });

      // Old password no longer works, new one does.
      await expect(service.login({ username, password: "original-password" })).rejects.toThrow(UnauthorizedException);
      const result = await service.login({ username, password: "brand-new-password" });
      expect(result).toBeDefined();
    });

    // Never reveals whether an email has an account — same {ok: true}
    // shape either way, and no email is ever sent for one that doesn't
    // exist (or has no passwordHash at all).
    test("requestPasswordReset() returns {ok: true} for an email with no account, and sends nothing", async () => {
      emailAdapter.passwordResetSent = [];
      const result = await service.requestPasswordReset(`nobody-${randomUUID()}@example.test`);
      expect(result).toEqual({ ok: true });
      expect(emailAdapter.passwordResetSent).toHaveLength(0);
    });

    test("resetPassword() rejects an unknown or already-used token", async () => {
      await expect(service.resetPassword({ token: "not-a-real-token", newPassword: "whatever-password" })).rejects.toThrow(
        BadRequestException,
      );
    });

    test("resetPassword() rejects an expired token", async () => {
      const email = testEmail("password-reset-expired");
      const username = testUsername("pwresetexpired");
      const { userId } = await service.signUp({
        fullName: "Password Reset Expired",
        email,
        username,
        password: "original-password",
      });
      await service.requestPasswordReset(email);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      // Simulate the token having been issued over an hour ago, rather
      // than waiting out PASSWORD_RESET_TOKEN_VALIDITY_HOURS for real.
      await prisma.user.update({ where: { id: userId }, data: { passwordResetTokenExpiresAt: new Date(Date.now() - 1000) } });

      await expect(
        service.resetPassword({ token: user.passwordResetToken!, newPassword: "brand-new-password" }),
      ).rejects.toThrow(BadRequestException);
    });

    test("resetPassword() rejects a password shorter than the minimum", async () => {
      const email = testEmail("password-reset-tooshort");
      const username = testUsername("pwresettooshort");
      await service.signUp({ fullName: "Password Reset Too Short", email, username, password: "original-password" });
      await service.requestPasswordReset(email);
      const token = new URL(emailAdapter.passwordResetSent.at(-1)!.link).searchParams.get("token")!;

      await expect(service.resetPassword({ token, newPassword: "short" })).rejects.toThrow(BadRequestException);
    });

    test("resetPassword() writes a user.password_reset audit log", async () => {
      const email = testEmail("password-reset-audit");
      const username = testUsername("pwresetaudit");
      const { userId } = await service.signUp({
        fullName: "Password Reset Audit",
        email,
        username,
        password: "original-password",
      });
      await service.requestPasswordReset(email);
      const token = new URL(emailAdapter.passwordResetSent.at(-1)!.link).searchParams.get("token")!;
      await service.resetPassword({ token, newPassword: "brand-new-password" });

      const logs = await prisma.auditLog.findMany({ where: { entityId: userId, action: "user.password_reset" } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorType: "founder_user", actorUserId: userId });
    });
  });

  test("login() succeeds with the correct username + password", async () => {
    const username = testUsername("loginhappypath");
    const { userId } = await service.signUp({
      fullName: "Login Happy Path",
      email: testEmail("login-happy-path"),
      username,
      password: "correct-horse-battery",
    });

    const result = await service.login({ username, password: "correct-horse-battery" });
    expect(result.userId).toBe(userId);
  });

  test("login() rejects an incorrect password", async () => {
    const username = testUsername("loginwrongpw");
    await service.signUp({
      fullName: "Login Wrong Password",
      email: testEmail("login-wrong-password"),
      username,
      password: "correct-horse-battery",
    });

    await expect(service.login({ username, password: "wrong-password" })).rejects.toThrow(UnauthorizedException);
  });

  test("login() rejects an unknown username", async () => {
    await expect(
      service.login({ username: "no-such-user-ever", password: "whatever-password" }),
    ).rejects.toThrow(UnauthorizedException);
  });

  test("verifyEmail() flips the user's status to active and consumes the token", async () => {
    const email = testEmail("verify-happy-path");
    const { userId } = await service.signUp({
      fullName: "Verify Contact",
      email,
      username: testUsername("verifyhappypath"),
      password: "correct-horse-battery",
    });

    const userBefore = await prisma.user.findUnique({ where: { id: userId } });
    const token = userBefore!.verificationToken!;

    const result = await service.verifyEmail(token);
    expect(result.userId).toBe(userId);

    const userAfter = await prisma.user.findUnique({ where: { id: userId } });
    expect(userAfter?.status).toBe("active");
    expect(userAfter?.verificationToken).toBeNull();
    expect(userAfter?.verificationTokenExpiresAt).toBeNull();

    const logs = await prisma.auditLog.findMany({
      where: { entityId: userAfter!.id, action: "user.email_verified" },
    });
    expect(logs).toHaveLength(1);
  });

  test("verifyEmail() rejects an unknown token", async () => {
    await expect(service.verifyEmail("not-a-real-token")).rejects.toThrow(NotFoundException);
  });

  test("verifyEmail() rejects an already-consumed token", async () => {
    const { userId } = await service.signUp({
      fullName: "Verify Replay",
      email: testEmail("verify-replay"),
      username: testUsername("verifyreplay"),
      password: "correct-horse-battery",
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const token = user!.verificationToken!;

    await service.verifyEmail(token);
    await expect(service.verifyEmail(token)).rejects.toThrow(NotFoundException);
  });

  test("verifyEmail() rejects an expired token", async () => {
    const { userId } = await service.signUp({
      fullName: "Verify Expired",
      email: testEmail("verify-expired"),
      username: testUsername("verifyexpired"),
      password: "correct-horse-battery",
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await prisma.user.update({
      where: { id: user!.id },
      data: { verificationTokenExpiresAt: new Date(Date.now() - 1000) },
    });

    await expect(service.verifyEmail(user!.verificationToken!)).rejects.toThrow(BadRequestException);
  });
});

describe("FoundersService.establishFounderAndFoundation", () => {
  const emailAdapter = new FakeEmailAdapter();
  const service = new FoundersService(emailAdapter as unknown as ResendVerificationEmailAdapter, new LogoStorageService(), new EncryptionService(), new MfaService());

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createVerifiedUser(label: string) {
    const { userId } = await service.signUp({
      fullName: `${label} Contact`,
      email: testEmail(label),
      username: testUsername(label),
      password: "correct-horse-battery",
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await prisma.user.update({
      where: { id: userId },
      data: { status: "active", verificationToken: null, whatsappVerifiedAt: new Date() },
    });
    return { userId, email: user.email };
  }

  test("rejects if the user hasn't verified email yet", async () => {
    const { userId } = await service.signUp({
      fullName: "Unverified",
      email: testEmail("establish-unverified-email"),
      username: testUsername("establishunverifiedemail"),
      password: "correct-horse-battery",
    });
    await expect(
      service.establishFounderAndFoundation(userId, {
        founderName: "Test Founder",
        kind: "institution",
        foundationName: "Test Foundation",
        purpose: "Testing",
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  test("rejects if the user hasn't verified WhatsApp yet", async () => {
    const { userId } = await service.signUp({
      fullName: "Email Only",
      email: testEmail("establish-no-whatsapp"),
      username: testUsername("establishnowhatsapp"),
      password: "correct-horse-battery",
    });
    await prisma.user.update({ where: { id: userId }, data: { status: "active", verificationToken: null } });

    await expect(
      service.establishFounderAndFoundation(userId, {
        founderName: "Test Founder",
        kind: "institution",
        foundationName: "Test Foundation",
        purpose: "Testing",
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  test("happy path: creates Founder + FounderMembership + Foundation atomically, audit-logs both, saves the logo", async () => {
    const { userId } = await createVerifiedUser("establish-happy-path");

    const { founder, foundation } = await service.establishFounderAndFoundation(
      userId,
      {
        founderName: "Establish Spec Founder",
        kind: "institution",
        institutionType: "ngo",
        homeJurisdiction: "AE",
        foundationName: "Establish Spec Foundation",
        purpose: "Testing establishment",
        jurisdiction: "AE",
      },
      FAKE_LOGO,
    );

    expect(founder.name).toBe("Establish Spec Founder");
    expect(foundation.name).toBe("Establish Spec Foundation");
    expect(foundation.logoUrl).toMatch(/^http/);

    const membership = await prisma.founderMembership.findFirst({ where: { userId, founderId: founder.id } });
    expect(membership).toMatchObject({ permissionLevel: "primary_contact" });

    const founderLogs = await prisma.auditLog.findMany({ where: { entityId: founder.id, action: "founder.created" } });
    expect(founderLogs).toHaveLength(1);
    const foundationLogs = await prisma.auditLog.findMany({
      where: { entityId: foundation.id, action: "foundation.created" },
    });
    expect(foundationLogs).toHaveLength(1);
  });

  test("rejects establishing a second Founder for the same user", async () => {
    const { userId } = await createVerifiedUser("establish-duplicate");
    await service.establishFounderAndFoundation(userId, {
      founderName: "First Founder",
      kind: "institution",
      foundationName: "First Foundation",
      purpose: "Testing",
    });

    await expect(
      service.establishFounderAndFoundation(userId, {
        founderName: "Second Founder",
        kind: "institution",
        foundationName: "Second Foundation",
        purpose: "Testing",
      }),
    ).rejects.toThrow(ConflictException);
  });

  test("rejects a missing purpose", async () => {
    const { userId } = await createVerifiedUser("establish-no-purpose");
    await expect(
      service.establishFounderAndFoundation(userId, {
        founderName: "No Purpose Founder",
        kind: "institution",
        foundationName: "No Purpose Foundation",
        purpose: "",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // Regression coverage for the 2026-09-26 agent draft-disposition
  // enhancement — see DISPOSITION_ACTION's own comment in
  // ai-agents.service.ts for why Rafiq is the one agent with this
  // wired up. Simulates what draftPurposeSuggestion() itself writes
  // (a real HTTP round trip to the agent service isn't needed to test
  // establishFounderAndFoundation's own disposition-recording logic).
  describe("onboarding_assist.disposition_recorded", () => {
    async function createRafiqDraft(userId: string, suggestedPurpose: string) {
      const rafiq = await prisma.aiAgent.upsert({
        where: { name: "rafiq" },
        update: {},
        create: { name: "rafiq", taskType: "founder_onboarding", status: "active" },
      });
      const draft = await prisma.auditLog.create({
        data: {
          actorType: "ai_agent",
          actorAgentId: rafiq.id,
          action: "onboarding_assist.drafted",
          entityType: "User",
          entityId: userId,
          after: { suggestedPurpose } as any,
        },
      });
      return draft.id;
    }

    test("records \"accepted\" when the submitted purpose matches Rafiq's suggestion verbatim", async () => {
      const { userId } = await createVerifiedUser("disp-accepted");
      const rafiqDraftId = await createRafiqDraft(userId, "Fund scholarships for underprivileged students.");

      const { founder } = await service.establishFounderAndFoundation(userId, {
        founderName: "Disposition Accepted Founder",
        kind: "institution",
        foundationName: "Disposition Accepted Foundation",
        purpose: "Fund scholarships for underprivileged students.",
        rafiqDraftId,
      });

      const logs = await prisma.auditLog.findMany({
        where: { action: "onboarding_assist.disposition_recorded", entityId: userId },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorType: "founder_user", actorUserId: userId, actorFounderId: founder.id });
      expect(logs[0]!.after).toMatchObject({ rafiqDraftId, disposition: "accepted" });
    });

    test("records \"changed\" when the submitted purpose differs from Rafiq's suggestion", async () => {
      const { userId } = await createVerifiedUser("disp-changed");
      const rafiqDraftId = await createRafiqDraft(userId, "Fund scholarships for underprivileged students.");

      await service.establishFounderAndFoundation(userId, {
        founderName: "Disposition Changed Founder",
        kind: "institution",
        foundationName: "Disposition Changed Foundation",
        purpose: "Provide microfinance loans to small rural businesses.",
        rafiqDraftId,
      });

      const logs = await prisma.auditLog.findMany({
        where: { action: "onboarding_assist.disposition_recorded", entityId: userId },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]!.after).toMatchObject({ disposition: "changed" });
    });

    test("records nothing when no rafiqDraftId is submitted — a Founder who never asked for help", async () => {
      const { userId } = await createVerifiedUser("disp-no-draft");
      await service.establishFounderAndFoundation(userId, {
        founderName: "No Draft Founder",
        kind: "institution",
        foundationName: "No Draft Foundation",
        purpose: "Written entirely on my own.",
      });

      const logs = await prisma.auditLog.findMany({
        where: { action: "onboarding_assist.disposition_recorded", entityId: userId },
      });
      expect(logs).toHaveLength(0);
    });

    test("fails soft (no disposition, establishment still succeeds) for a draftId belonging to a different user", async () => {
      const { userId: otherUserId } = await createVerifiedUser("disp-other-owner");
      const rafiqDraftId = await createRafiqDraft(otherUserId, "Someone else's suggested purpose.");

      const { userId } = await createVerifiedUser("disp-wrong-owner");
      const result = await service.establishFounderAndFoundation(userId, {
        founderName: "Wrong Owner Founder",
        kind: "institution",
        foundationName: "Wrong Owner Foundation",
        purpose: "My own purpose, unrelated to that draft.",
        rafiqDraftId,
      });

      expect(result.founder.name).toBe("Wrong Owner Founder");
      const logs = await prisma.auditLog.findMany({
        where: { action: "onboarding_assist.disposition_recorded", entityId: userId },
      });
      expect(logs).toHaveLength(0);
    });

    test("fails soft for an unknown/garbage draftId — establishment still succeeds", async () => {
      const { userId } = await createVerifiedUser("disp-garbage-id");
      const result = await service.establishFounderAndFoundation(userId, {
        founderName: "Garbage Id Founder",
        kind: "institution",
        foundationName: "Garbage Id Foundation",
        purpose: "My own purpose.",
        rafiqDraftId: "00000000-0000-0000-0000-000000000000",
      });

      expect(result.founder.name).toBe("Garbage Id Founder");
    });
  });
});

describe("FoundersService.getOnboardingStatus", () => {
  const emailAdapter = new FakeEmailAdapter();
  const service = new FoundersService(emailAdapter as unknown as ResendVerificationEmailAdapter, new LogoStorageService(), new EncryptionService(), new MfaService());

  afterAll(async () => {
    // Deliberately no cleanup here, unlike other spec files' Foundation/
    // Waqf fixtures — this describe block's progression test signs a real
    // WaqfDeed against its fixture Waqf, and waqf_deeds is immutable
    // (UPDATE/DELETE revoked at the DB role level, same as audit_logs),
    // so its waqfId FK (ON DELETE RESTRICT) permanently blocks deleting
    // that Waqf. Left in place, identifiable by its timestamped name.
    await prisma.$disconnect();
  });

  test("currentStep progresses correctly across all 6 states", async () => {
    const email = testEmail("onboarding-status-progression");
    const { userId } = await service.signUp({
      fullName: "Onboarding Spec Contact",
      email,
      username: testUsername("onboardingstatusprogression"),
      password: "correct-horse-battery",
    });

    // State 1: nothing verified yet.
    let status = await service.getOnboardingStatus(userId);
    expect(status.currentStep).toBe(1);
    expect(status.steps.emailVerified.complete).toBe(false);
    expect(status.onboardingComplete).toBe(false);

    // State 2: email verified, WhatsApp not yet.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    await service.verifyEmail(user!.verificationToken!);
    status = await service.getOnboardingStatus(userId);
    expect(status.currentStep).toBe(1);
    expect(status.steps.emailVerified.complete).toBe(true);
    expect(status.steps.whatsappVerified.complete).toBe(false);

    // State 3: WhatsApp also verified -> step 2 (establish founder + foundation).
    await prisma.user.update({ where: { id: userId }, data: { whatsappVerifiedAt: new Date() } });
    status = await service.getOnboardingStatus(userId);
    expect(status.currentStep).toBe(2);
    expect(status.steps.foundationEstablished.complete).toBe(false);

    // State 4: Founder + Foundation established -> step 3 (fund the first waqf).
    const { founder, foundation } = await service.establishFounderAndFoundation(userId, {
      founderName: "Onboarding Spec Founder",
      kind: "institution",
      foundationName: "Onboarding Spec Foundation",
      purpose: "Testing",
    });
    status = await service.getOnboardingStatus(userId);
    expect(status.currentStep).toBe(3);
    expect(status.founderId).toBe(founder.id);
    expect(status.steps.foundationEstablished.foundationId).toBe(foundation.id);
    expect(status.steps.firstWaqfFunded.complete).toBe(false);

    // State 5: first Waqf active (funded) -> step 4 (sign the deed).
    const waqf = await prisma.waqf.create({
      data: { name: "Onboarding Spec Waqf", type: "asset", jurisdiction: "AE", foundationId: foundation.id, status: "active" },
    });
    status = await service.getOnboardingStatus(userId);
    expect(status.currentStep).toBe(4);
    expect(status.steps.firstWaqfFunded.waqfId).toBe(waqf.id);
    expect(status.steps.deedSigned.complete).toBe(false);

    // State 6: deed signed -> done, onboardingComplete. Deed-signing is
    // Foundation-level, not per-Waqf — see FoundationDeed's own schema
    // comment.
    await prisma.foundationDeed.create({
      data: {
        foundationId: foundation.id,
        signedByUserId: userId,
        signedByFounderId: founder.id,
        typedLegalName: "Onboarding Spec Contact",
        deedTemplateVersion: "v1-2026-08",
        deedText: "test deed text",
        affirmed: true,
      },
    });
    status = await service.getOnboardingStatus(userId);
    expect(status.currentStep).toBe("done");
    expect(status.steps.deedSigned.complete).toBe(true);
    expect(status.onboardingComplete).toBe(true);
  });
});

// Opt-in, unlike birr_staff's mandatory MFA — nothing here forces
// enrollment, so every test creates a fixture User directly rather than
// going through signUp() (no Founder/Foundation needed at all for MFA
// itself, which lives entirely on the User row).
describe("FoundersService MFA", () => {
  const service = new FoundersService(
    undefined as never,
    undefined as never,
    new EncryptionService(),
    new MfaService(),
  );

  let mfaUserId: string;
  let actorStaffUserId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: testEmail("mfa-founder"), fullName: "MFA Founder Fixture" },
    });
    mfaUserId = user.id;

    // A platform_admin acting as the reset button's caller — resetMfa()
    // itself doesn't check the role (the controller does), so any real
    // User id is enough to prove actorUserId lands correctly on the
    // audit log.
    const actorUser = await prisma.user.create({
      data: { email: testEmail("mfa-founder-admin-actor"), fullName: "MFA Reset Actor" },
    });
    actorStaffUserId = actorUser.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("confirmMfaEnrollment() rejects a code that doesn't match the pending secret", async () => {
    await service.startMfaEnrollment(mfaUserId);
    await expect(service.confirmMfaEnrollment(mfaUserId, "000000")).rejects.toThrow(BadRequestException);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: mfaUserId } });
    expect(user.mfaEnabled).toBe(false);
  }, 20000);

  test("confirmMfaEnrollment() rejects confirming before enrollment has started", async () => {
    const user = await prisma.user.create({
      data: { email: testEmail("mfa-founder-unstarted"), fullName: "Unstarted MFA Founder" },
    });
    await expect(service.confirmMfaEnrollment(user.id, "123456")).rejects.toThrow(BadRequestException);
  });

  test("enrollment start -> confirm with a real code enables MFA and issues 10 usable backup codes", async () => {
    const { secretForManualEntry } = await service.startMfaEnrollment(mfaUserId);
    const { backupCodes } = await service.confirmMfaEnrollment(mfaUserId, codeFor(secretForManualEntry));

    expect(backupCodes).toHaveLength(10);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: mfaUserId } });
    expect(user.mfaEnabled).toBe(true);

    const logs = await prisma.auditLog.findMany({ where: { entityId: mfaUserId, action: "founder.mfa_enabled" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "founder_user", actorUserId: mfaUserId });

    await expect(service.verifyLoginMfaCode(mfaUserId, codeFor(secretForManualEntry))).resolves.toBeUndefined();
    await expect(service.verifyLoginMfaCode(mfaUserId, "000000")).rejects.toThrow(UnauthorizedException);

    // A backup code works exactly once.
    const backupCode = backupCodes[0]!;
    await expect(service.verifyLoginMfaCode(mfaUserId, backupCode)).resolves.toBeUndefined();
    await expect(service.verifyLoginMfaCode(mfaUserId, backupCode)).rejects.toThrow(UnauthorizedException);
  }, 25000);

  test("resetMfa() clears MFA state, deletes backup codes, and is audit-logged against the acting staff member", async () => {
    const { secretForManualEntry } = await service.startMfaEnrollment(mfaUserId);
    await service.confirmMfaEnrollment(mfaUserId, codeFor(secretForManualEntry));

    await service.resetMfa(mfaUserId, actorStaffUserId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: mfaUserId } });
    expect(user.mfaEnabled).toBe(false);
    expect(user.mfaSecretEncrypted).toBeNull();

    const remainingCodes = await prisma.mfaBackupCode.findMany({ where: { userId: mfaUserId } });
    expect(remainingCodes).toHaveLength(0);

    const logs = await prisma.auditLog.findMany({ where: { entityId: mfaUserId, action: "founder.mfa_reset" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId: actorStaffUserId });
  }, 25000);

  test("resetMfa() rejects an unknown user id", async () => {
    await expect(service.resetMfa(randomUUID(), actorStaffUserId)).rejects.toThrow(NotFoundException);
  });
});
