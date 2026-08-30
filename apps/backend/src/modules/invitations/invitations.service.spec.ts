import { prisma } from "@birr/db";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { InvitationsService } from "./invitations.service";
import { ResendInvitationEmailAdapter } from "./email/resend-invitation.adapter";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";
import { FoundationsService } from "../foundations/foundations.service";

// Same fake-adapter pattern as founders.service.spec.ts's FakeEmailAdapter
// — no real Resend call in tests, and shouldFail lets the "email didn't
// send, invitation still created" path get real coverage below.
class FakeInvitationEmailAdapter {
  sent: { to: string; link: string }[] = [];
  shouldFail = false;

  async sendInvitationEmail(to: string, link: string): Promise<void> {
    if (this.shouldFail) throw new Error("delivery failed");
    this.sent.push({ to, link });
  }
}

describe("InvitationsService", () => {
  const emailAdapter = new FakeInvitationEmailAdapter();
  const service = new InvitationsService(emailAdapter as unknown as ResendInvitationEmailAdapter, createFakeNotificationsService());

  const foundationsService = new FoundationsService();

  const invitationIds: string[] = [];
  const founderIds: string[] = [];
  const userIds: string[] = [];
  const waqfIds: string[] = [];

  let inviterUserId: string;
  let existingFounderId: string;

  // A second Foundation with its own primary_contact — the fixture for
  // every co_founder test below. Has a pre-existing Waqf so accept()'s
  // RLS-sharing claim can actually be exercised, not just asserted.
  let coFounderFoundationId: string;
  let coFounderFounderAId: string;
  let coFounderInviterUserId: string;
  let unrelatedFounderId: string;
  let preExistingWaqfId: string;

  beforeAll(async () => {
    const inviterUser = await prisma.user.create({
      data: { email: `invitation-inviter-${Date.now()}@example.com`, fullName: "Test Inviter" },
    });
    inviterUserId = inviterUser.id;
    await prisma.birrStaff.create({
      data: { userId: inviterUser.id, staffRole: "mutawalli_officer" },
    });

    const founder = await prisma.founder.create({
      data: { name: "Invitation Fixture Founder", kind: "institution" },
    });
    existingFounderId = founder.id;
    founderIds.push(founder.id);

    // co_founder fixtures
    const founderA = await prisma.founder.create({
      data: { name: "Co-Founder Spec Founder A", kind: "institution" },
    });
    coFounderFounderAId = founderA.id;
    founderIds.push(founderA.id);

    const coFounderInviterUser = await prisma.user.create({
      data: { email: `co-founder-inviter-${Date.now()}@example.com`, fullName: "Founder A Primary Contact" },
    });
    coFounderInviterUserId = coFounderInviterUser.id;
    userIds.push(coFounderInviterUser.id);
    await prisma.founderMembership.create({
      data: { founderId: founderA.id, userId: coFounderInviterUser.id, permissionLevel: "primary_contact" },
    });

    const unrelatedFounder = await prisma.founder.create({
      data: { name: "Co-Founder Spec Unrelated Founder", kind: "institution" },
    });
    unrelatedFounderId = unrelatedFounder.id;
    founderIds.push(unrelatedFounder.id);

    const coFoundation = await foundationsService.create({
      name: "Co-Founder Spec Foundation",
      purpose: "Testing joint establishment",
      founderIds: [founderA.id],
    });
    coFounderFoundationId = coFoundation.id;

    const waqf = await prisma.waqf.create({
      data: {
        name: "Co-Founder Spec Waqf",
        type: "asset",
        jurisdiction: "AE",
        foundationId: coFounderFoundationId,
      },
    });
    preExistingWaqfId = waqf.id;
    waqfIds.push(waqf.id);
  });

  afterAll(async () => {
    // FK-safe order: FounderMembership/BirrStaff (created by accept())
    // before the Users/Founders they reference. Fixture Users/BirrStaff
    // created directly (not via accept()) are left in place, same
    // reasoning as every other spec file — audit_logs.actorUserId is
    // insert-only at the DB role level.
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.founderMembership.deleteMany({ where: { founderId: { in: founderIds } } });
    await prisma.invitation.deleteMany({ where: { id: { in: invitationIds } } });
    await prisma.$disconnect();
  });

  function auditLogsFor(entityId: string) {
    return prisma.auditLog.findMany({ where: { entityId } });
  }

  test("invite() for birr_staff creates a pending invitation and an audit log", async () => {
    const invitation = await service.invite({
      inviteeKind: "birr_staff",
      email: `invitee-staff-${Date.now()}@example.com`,
      roleKey: "compliance_officer",
      invitedByUserId: inviterUserId,
    });
    invitationIds.push(invitation.id);

    expect(invitation.status).toBe("pending");
    expect(invitation.token).toHaveLength(64); // 32 bytes, hex-encoded
    expect(invitation.emailSent).toBe(true);
    expect(emailAdapter.sent.some((s) => s.to === invitation.email && s.link.includes(invitation.token))).toBe(true);

    const logs = await auditLogsFor(invitation.id);
    expect(logs.some((l) => l.action === "invitation.sent")).toBe(true);
  });

  test("invite() still creates a real invitation when the email fails to send", async () => {
    emailAdapter.shouldFail = true;
    try {
      const invitation = await service.invite({
        inviteeKind: "birr_staff",
        email: `invitee-staff-emailfail-${Date.now()}@example.com`,
        roleKey: "compliance_officer",
        invitedByUserId: inviterUserId,
      });
      invitationIds.push(invitation.id);

      expect(invitation.status).toBe("pending");
      expect(invitation.emailSent).toBe(false);
    } finally {
      emailAdapter.shouldFail = false;
    }
  });

  test("invite() for founder_user rejects an unknown founderId with a clean 404", async () => {
    await expect(
      service.invite({
        inviteeKind: "founder_user",
        email: `invitee-founder-${Date.now()}@example.com`,
        founderId: "00000000-0000-0000-0000-000000000000",
        roleKey: "viewer",
        invitedByUserId: inviterUserId,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  test("accept() for birr_staff creates a User + BirrStaff and flips status to accepted", async () => {
    const invitation = await service.invite({
      inviteeKind: "birr_staff",
      email: `accept-staff-${Date.now()}@example.com`,
      roleKey: "audit_committee",
      invitedByUserId: inviterUserId,
    });
    invitationIds.push(invitation.id);

    const result = await service.accept({ token: invitation.token, fullName: "New Staff Member", password: "correct-horse-battery" });
    userIds.push(result.user.id);

    expect(result.invitation.status).toBe("accepted");
    expect(result.user.email).toBe(invitation.email);
    expect(result.membershipOrStaff).toMatchObject({
      userId: result.user.id,
      staffRole: "audit_committee",
    });

    const logs = await auditLogsFor(invitation.id);
    expect(
      logs.some((l) => l.action === "invitation.accepted" && l.actorUserId === result.user.id),
    ).toBe(true);
  });

  test("accept() for founder_user creates a User + FounderMembership with the correct permissionLevel", async () => {
    const invitation = await service.invite({
      inviteeKind: "founder_user",
      email: `accept-founder-${Date.now()}@example.com`,
      founderId: existingFounderId,
      roleKey: "primary_contact",
      invitedByUserId: inviterUserId,
    });
    invitationIds.push(invitation.id);

    const result = await service.accept({ token: invitation.token, fullName: "New Founder User", password: "correct-horse-battery" });
    userIds.push(result.user.id);

    expect(result.membershipOrStaff).toMatchObject({
      founderId: existingFounderId,
      userId: result.user.id,
      permissionLevel: "primary_contact",
    });
  });

  test("accept() rejects an expired invitation and flips its status to expired", async () => {
    const invitation = await service.invite({
      inviteeKind: "birr_staff",
      email: `expired-${Date.now()}@example.com`,
      roleKey: "legal_adviser",
      invitedByUserId: inviterUserId,
    });
    invitationIds.push(invitation.id);
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      service.accept({ token: invitation.token, fullName: "Too Late", password: "correct-horse-battery" }),
    ).rejects.toThrow(BadRequestException);

    const reloaded = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(reloaded.status).toBe("expired");
  });

  test("accept() rejects reusing an already-accepted token", async () => {
    const invitation = await service.invite({
      inviteeKind: "birr_staff",
      email: `reuse-${Date.now()}@example.com`,
      roleKey: "platform_admin",
      invitedByUserId: inviterUserId,
    });
    invitationIds.push(invitation.id);

    const result = await service.accept({ token: invitation.token, fullName: "First Accept", password: "correct-horse-battery" });
    userIds.push(result.user.id);

    await expect(
      service.accept({ token: invitation.token, fullName: "Second Accept", password: "correct-horse-battery" }),
    ).rejects.toThrow(BadRequestException);
  });

  test("accept() rejects with a clean error when a User already exists for the invited email, instead of an unhandled unique-constraint crash", async () => {
    const email = `already-has-account-${Date.now()}@example.com`;
    // A stray User row for this email, unrelated to this invitation — the
    // same shape as an abandoned self-service sign-up that never
    // verified (FoundersService.signUp leaves status "invited"
    // indefinitely in that case).
    const existingUser = await prisma.user.create({
      data: { email, fullName: "Already Signed Up", status: "invited" },
    });
    userIds.push(existingUser.id);

    const invitation = await service.invite({
      inviteeKind: "birr_staff",
      email,
      roleKey: "legal_adviser",
      invitedByUserId: inviterUserId,
    });
    invitationIds.push(invitation.id);

    await expect(
      service.accept({ token: invitation.token, fullName: "Collides With Existing", password: "correct-horse-battery" }),
    ).rejects.toThrow(ConflictException);

    // Neither the invitation nor the pre-existing user should be
    // mutated by the failed attempt.
    const reloaded = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(reloaded.status).toBe("pending");
  });

  test("revoke() transitions pending to revoked and rejects revoking a non-pending invitation", async () => {
    const invitation = await service.invite({
      inviteeKind: "birr_staff",
      email: `revoke-${Date.now()}@example.com`,
      roleKey: "shariah_board_member",
      invitedByUserId: inviterUserId,
    });
    invitationIds.push(invitation.id);

    const revoked = await service.revoke(invitation.id, inviterUserId);
    expect(revoked.status).toBe("revoked");

    await expect(service.revoke(invitation.id, inviterUserId)).rejects.toThrow(
      BadRequestException,
    );
  });

  describe("co_founder invitations", () => {
    test("invite() requires foundationId and rejects founderId being set", async () => {
      await expect(
        service.invite({
          inviteeKind: "co_founder",
          email: `co-founder-missing-foundation-${Date.now()}@example.com`,
          roleKey: "",
          invitedByUserId: coFounderInviterUserId,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.invite({
          inviteeKind: "co_founder",
          email: `co-founder-with-founderid-${Date.now()}@example.com`,
          founderId: coFounderFounderAId,
          foundationId: coFounderFoundationId,
          roleKey: "",
          invitedByUserId: coFounderInviterUserId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    test("invite() rejects an unknown foundationId with a clean 404", async () => {
      await expect(
        service.invite({
          inviteeKind: "co_founder",
          email: `co-founder-unknown-foundation-${Date.now()}@example.com`,
          foundationId: "00000000-0000-0000-0000-000000000000",
          roleKey: "",
          invitedByUserId: coFounderInviterUserId,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    test("invite() for a valid co_founder invitation creates a pending invitation with no founderId and an audit log", async () => {
      const invitation = await service.invite({
        inviteeKind: "co_founder",
        email: `co-founder-invite-${Date.now()}@example.com`,
        foundationId: coFounderFoundationId,
        roleKey: "",
        invitedByUserId: coFounderInviterUserId,
        invitedByActorType: "founder_user",
        invitedByFounderId: coFounderFounderAId,
      });
      invitationIds.push(invitation.id);

      expect(invitation.status).toBe("pending");
      expect(invitation.founderId).toBeNull();
      expect(invitation.foundationId).toBe(coFounderFoundationId);

      const logs = await auditLogsFor(invitation.id);
      expect(logs.some((l) => l.action === "invitation.sent")).toBe(true);
    });

    test("accept() creates a new Founder + primary_contact membership + FoundationFounder row, with both audit logs", async () => {
      const invitation = await service.invite({
        inviteeKind: "co_founder",
        email: `co-founder-accept-${Date.now()}@example.com`,
        foundationId: coFounderFoundationId,
        roleKey: "",
        invitedByUserId: coFounderInviterUserId,
        invitedByActorType: "founder_user",
        invitedByFounderId: coFounderFounderAId,
      });
      invitationIds.push(invitation.id);

      const result = await service.accept({
        token: invitation.token,
        fullName: "Founder B Primary Contact",
        password: "correct-horse-battery",
        founderName: "Co-Founder Spec Founder B",
        kind: "institution",
        institutionType: "ngo",
      });
      userIds.push(result.user.id);
      const newFounderId = result.newFounderId!;
      founderIds.push(newFounderId);

      expect(result.invitation.status).toBe("accepted");
      expect(result.membershipOrStaff).toMatchObject({
        founderId: newFounderId,
        userId: result.user.id,
        permissionLevel: "primary_contact",
      });

      const founder = await prisma.founder.findUniqueOrThrow({ where: { id: newFounderId } });
      expect(founder).toMatchObject({ name: "Co-Founder Spec Founder B", kind: "institution", institutionType: "ngo" });

      const joinRow = await prisma.foundationFounder.findUnique({
        where: { foundationId_founderId: { foundationId: coFounderFoundationId, founderId: newFounderId } },
      });
      expect(joinRow).not.toBeNull();

      const founderLogs = await auditLogsFor(newFounderId);
      expect(founderLogs.some((l) => l.action === "founder.created")).toBe(true);
      const joinLogs = await auditLogsFor(`${coFounderFoundationId}:${newFounderId}`);
      expect(joinLogs.some((l) => l.action === "foundationFounder.created")).toBe(true);
    });

    test("accept() rejects a co_founder invitation missing founderName/kind", async () => {
      const invitation = await service.invite({
        inviteeKind: "co_founder",
        email: `co-founder-missing-identity-${Date.now()}@example.com`,
        foundationId: coFounderFoundationId,
        roleKey: "",
        invitedByUserId: coFounderInviterUserId,
        invitedByActorType: "founder_user",
        invitedByFounderId: coFounderFounderAId,
      });
      invitationIds.push(invitation.id);

      await expect(
        service.accept({ token: invitation.token, fullName: "No Identity Given", password: "correct-horse-battery" }),
      ).rejects.toThrow(BadRequestException);
    });

    test("the new co-founder immediately has RLS-backed access to the original founder's pre-existing Waqf — no other code path changed", async () => {
      const invitation = await service.invite({
        inviteeKind: "co_founder",
        email: `co-founder-rls-${Date.now()}@example.com`,
        foundationId: coFounderFoundationId,
        roleKey: "",
        invitedByUserId: coFounderInviterUserId,
        invitedByActorType: "founder_user",
        invitedByFounderId: coFounderFounderAId,
      });
      invitationIds.push(invitation.id);

      const result = await service.accept({
        token: invitation.token,
        fullName: "Founder C Primary Contact",
        password: "correct-horse-battery",
        founderName: "Co-Founder Spec Founder C",
        kind: "individual",
      });
      userIds.push(result.user.id);
      founderIds.push(result.newFounderId!);

      const foundation = await foundationsService.findByIdForFounder(coFounderFoundationId, result.newFounderId!);
      expect(foundation?.id).toBe(coFounderFoundationId);
      expect(foundation?._count.waqfs).toBeGreaterThanOrEqual(1);
    });

    test("revoke(): an existing co-founder can revoke a pending co_founder invitation for their own Foundation, but an unrelated founder gets 404", async () => {
      const invitation = await service.invite({
        inviteeKind: "co_founder",
        email: `co-founder-revoke-${Date.now()}@example.com`,
        foundationId: coFounderFoundationId,
        roleKey: "",
        invitedByUserId: coFounderInviterUserId,
        invitedByActorType: "founder_user",
        invitedByFounderId: coFounderFounderAId,
      });
      invitationIds.push(invitation.id);

      await expect(
        service.revoke(invitation.id, coFounderInviterUserId, { type: "founder_user", founderId: unrelatedFounderId }),
      ).rejects.toThrow(NotFoundException);

      const revoked = await service.revoke(invitation.id, coFounderInviterUserId, {
        type: "founder_user",
        founderId: coFounderFounderAId,
      });
      expect(revoked.status).toBe("revoked");
    });

    test("listForFounder(): a co_founder invitation sent for a shared Foundation shows up for every co-founder on it", async () => {
      const invitation = await service.invite({
        inviteeKind: "co_founder",
        email: `co-founder-list-${Date.now()}@example.com`,
        foundationId: coFounderFoundationId,
        roleKey: "",
        invitedByUserId: coFounderInviterUserId,
        invitedByActorType: "founder_user",
        invitedByFounderId: coFounderFounderAId,
      });
      invitationIds.push(invitation.id);

      const forFounderA = await service.listForFounder(coFounderFounderAId);
      expect(forFounderA.some((i) => i.id === invitation.id)).toBe(true);

      const forUnrelatedFounder = await service.listForFounder(unrelatedFounderId);
      expect(forUnrelatedFounder.some((i) => i.id === invitation.id)).toBe(false);
    });
  });
});
