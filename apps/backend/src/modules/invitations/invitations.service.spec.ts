import { prisma } from "@birr/db";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { InvitationsService } from "./invitations.service";
import { ResendInvitationEmailAdapter } from "./email/resend-invitation.adapter";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";
import { FoundationsService } from "../foundations/foundations.service";
import { CO_FOUNDER_STATEMENT_VERSION } from "../foundation-deeds/co-founder-consent";

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

  // A staff invitation the way the staff.invite approval creates one —
  // invite() refuses the birr_staff kind outright.
  async function staffInvitation(email: string, roleKey: string) {
    const invitation = await prisma.$transaction((tx) =>
      service.createStaffInvitationInTransaction({ email, roleKey, invitedByUserId: inviterUserId }, tx),
    );
    invitationIds.push(invitation.id);
    return invitation;
  }

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

  beforeAll(async () => {
    const inviterUser = await prisma.user.create({
      data: { email: `invitation-inviter-${Date.now()}@example.com`, fullName: "Test Inviter" },
    });
    inviterUserId = inviterUser.id;
    await prisma.birrStaff.create({
      data: { userId: inviterUser.id, roles: { create: { role: "mutawalli_officer" } } },
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

  test("invite() refuses a birr_staff invitation — adding staff is the staff.invite governed action", async () => {
    const email = `invitee-staff-direct-${Date.now()}@example.com`;
    await expect(
      service.invite({ inviteeKind: "birr_staff", email, roleKey: "compliance_officer", invitedByUserId: inviterUserId }),
    ).rejects.toThrow(BadRequestException);
    expect(await prisma.invitation.count({ where: { email } })).toBe(0);
  });

  test("a staff invitation is created without an email, then delivered by deliverById() with its link", async () => {
    const invitation = await staffInvitation(`invitee-staff-${Date.now()}@example.com`, "compliance_officer");
    expect(invitation.status).toBe("pending");
    expect(invitation.token).toHaveLength(64); // 32 bytes, hex-encoded
    expect(emailAdapter.sent.some((s) => s.to === invitation.email)).toBe(false);

    expect(await service.deliverById(invitation.id)).toBe(true);
    expect(emailAdapter.sent.some((s) => s.to === invitation.email && s.link.includes(invitation.token))).toBe(true);
  });

  test("invite() audit-logs the invitation without its token", async () => {
    const invitation = await service.invite({
      inviteeKind: "founder_user",
      email: `invitee-founder-audit-${Date.now()}@example.com`,
      founderId: existingFounderId,
      roleKey: "viewer",
      invitedByUserId: inviterUserId,
    });
    invitationIds.push(invitation.id);

    const log = (await auditLogsFor(invitation.id)).find((l) => l.action === "invitation.sent");
    if (!log) throw new Error("expected an invitation.sent audit log");
    expect((log.after as { token: string }).token).toBe("[redacted]");
    expect(JSON.stringify(log.after)).not.toContain(invitation.token);
  });

  test("list() and findById() hide a staff invitation's token but keep a founder invitation's", async () => {
    const staff = await staffInvitation(`list-staff-${Date.now()}@example.com`, "legal_adviser");
    const founder = await service.invite({
      inviteeKind: "founder_user",
      email: `list-founder-${Date.now()}@example.com`,
      founderId: existingFounderId,
      roleKey: "viewer",
      invitedByUserId: inviterUserId,
    });
    invitationIds.push(founder.id);

    const listed = await service.list();
    expect(listed.find((i) => i.id === staff.id)?.token).toBeNull();
    expect(listed.find((i) => i.id === founder.id)?.token).toBe(founder.token);
    expect((await service.findById(staff.id))?.token).toBeNull();
    expect((await service.findById(founder.id))?.token).toBe(founder.token);
  });

  test("resendStaffInvitationEmail() re-sends a pending staff invitation and audit-logs it", async () => {
    const invitation = await staffInvitation(`resend-${Date.now()}@example.com`, "audit_committee");

    expect(await service.resendStaffInvitationEmail(invitation.id, inviterUserId)).toEqual({ emailSent: true });
    expect(emailAdapter.sent.some((s) => s.to === invitation.email && s.link.includes(invitation.token))).toBe(true);
    expect((await auditLogsFor(invitation.id)).some((l) => l.action === "invitation.email_resent")).toBe(true);
  });

  test("resendStaffInvitationEmail() refuses a founder invitation and a non-pending staff invitation", async () => {
    const founder = await service.invite({
      inviteeKind: "founder_user",
      email: `resend-founder-${Date.now()}@example.com`,
      founderId: existingFounderId,
      roleKey: "viewer",
      invitedByUserId: inviterUserId,
    });
    invitationIds.push(founder.id);
    await expect(service.resendStaffInvitationEmail(founder.id, inviterUserId)).rejects.toThrow(NotFoundException);

    const staff = await staffInvitation(`resend-revoked-${Date.now()}@example.com`, "audit_committee");
    await service.revoke(staff.id, inviterUserId, { type: "birr_staff", roles: ["platform_admin"] });
    await expect(service.resendStaffInvitationEmail(staff.id, inviterUserId)).rejects.toThrow(BadRequestException);
  });

  test("invite() still creates a real invitation when the email fails to send", async () => {
    emailAdapter.shouldFail = true;
    try {
      const invitation = await service.invite({
        inviteeKind: "founder_user",
        email: `invitee-founder-emailfail-${Date.now()}@example.com`,
        founderId: existingFounderId,
        roleKey: "viewer",
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
    const invitation = await staffInvitation(`accept-staff-${Date.now()}@example.com`, "audit_committee");

    const result = await service.accept({ token: invitation.token, fullName: "New Staff Member", password: "correct-horse-battery" });
    userIds.push(result.user.id);

    expect(result.invitation.status).toBe("accepted");
    expect(result.user.email).toBe(invitation.email);
    expect(result.membershipOrStaff).toMatchObject({ userId: result.user.id });
    const grants = await prisma.birrStaffRoleGrant.findMany({ where: { birrStaffId: result.membershipOrStaff.id } });
    expect(grants.map((g) => g.role)).toEqual(["audit_committee"]);

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
    const invitation = await staffInvitation(`expired-${Date.now()}@example.com`, "legal_adviser");
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
    const invitation = await staffInvitation(`reuse-${Date.now()}@example.com`, "platform_admin");

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

    const invitation = await staffInvitation(email, "legal_adviser");

    await expect(
      service.accept({ token: invitation.token, fullName: "Collides With Existing", password: "correct-horse-battery" }),
    ).rejects.toThrow(ConflictException);

    // Neither the invitation nor the pre-existing user should be
    // mutated by the failed attempt.
    const reloaded = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(reloaded.status).toBe("pending");
  });

  test("revoke() transitions pending to revoked and rejects revoking a non-pending invitation", async () => {
    const invitation = await staffInvitation(`revoke-${Date.now()}@example.com`, "shariah_board_member");

    const adminActor = { type: "birr_staff" as const, roles: ["platform_admin"] };
    const revoked = await service.revoke(invitation.id, inviterUserId, adminActor);
    expect(revoked.status).toBe("revoked");

    await expect(service.revoke(invitation.id, inviterUserId, adminActor)).rejects.toThrow(
      BadRequestException,
    );
  });

  test("revoke() rejects a non-platform_admin staff member revoking a birr_staff invitation", async () => {
    const invitation = await staffInvitation(`revoke-nonadmin-${Date.now()}@example.com`, "shariah_board_member");

    await expect(
      service.revoke(invitation.id, inviterUserId, { type: "birr_staff", roles: ["mutawalli_officer"] }),
    ).rejects.toThrow(ForbiddenException);
    const reloaded = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(reloaded.status).toBe("pending");
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
        deedConsentVersion: CO_FOUNDER_STATEMENT_VERSION,
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
        deedConsentVersion: CO_FOUNDER_STATEMENT_VERSION,
      });
      userIds.push(result.user.id);
      founderIds.push(result.newFounderId!);

      const foundation = await foundationsService.findByIdForFounder(coFounderFoundationId, result.newFounderId!);
      expect(foundation?.id).toBe(coFounderFoundationId);
      expect(foundation?._count.waqfs).toBeGreaterThanOrEqual(1);
    });

    function inviteCoFounder(foundationId: string, label: string) {
      return service
        .invite({
          inviteeKind: "co_founder",
          email: `co-founder-${label}-${Date.now()}-${Math.random()}@example.com`,
          foundationId,
          roleKey: "",
          invitedByUserId: coFounderInviterUserId,
          invitedByActorType: "founder_user",
          invitedByFounderId: coFounderFounderAId,
        })
        .then((invitation) => {
          invitationIds.push(invitation.id);
          return invitation;
        });
    }

    // null = the statement wasn't accepted at all (undefined would take the default).
    function acceptAsCoFounder(token: string, name: string, deedConsentVersion: string | null = CO_FOUNDER_STATEMENT_VERSION) {
      return service.accept(
        {
          token,
          fullName: name,
          password: "correct-horse-battery",
          founderName: name,
          kind: "individual",
          deedConsentVersion: deedConsentVersion ?? undefined,
        },
        "198.51.100.4",
      );
    }

    // A Foundation of Founder A's whose deed is already signed.
    async function foundationWithSignedDeed() {
      const foundation = await foundationsService.create({
        name: `Co-Founder Spec Signed Foundation ${Date.now()}`,
        purpose: "Testing adoption of a signed deed",
        founderIds: [coFounderFounderAId],
      });
      const deed = await prisma.foundationDeed.create({
        data: {
          foundationId: foundation.id,
          signedByUserId: coFounderInviterUserId,
          signedByFounderId: coFounderFounderAId,
          typedLegalName: "Founder A Primary Contact",
          deedTemplateVersion: "spec",
          deedText: "Spec deed",
          affirmed: true,
          signedAt: new Date("2026-11-14T09:00:00Z"),
        },
      });
      return { foundation, deed };
    }

    test("accept() refuses a co_founder who hasn't accepted the current deed statement, and creates nothing", async () => {
      const missing = await inviteCoFounder(coFounderFoundationId, "no-consent");
      await expect(acceptAsCoFounder(missing.token, "No Consent", null)).rejects.toThrow(BadRequestException);
      const stale = await inviteCoFounder(coFounderFoundationId, "old-consent");
      await expect(acceptAsCoFounder(stale.token, "Old Consent", "2000-01-01-old")).rejects.toThrow(BadRequestException);

      expect(await prisma.user.findUnique({ where: { email: missing.email } })).toBeNull();
      expect(await prisma.user.findUnique({ where: { email: stale.email } })).toBeNull();
    });

    test("accept() before the deed is signed records the co-founder's authorization of the signer, with an audit log", async () => {
      const invitation = await inviteCoFounder(coFounderFoundationId, "authorize");
      const preview = await service.previewCoFounderInvitation(invitation.token);
      expect(preview.statement.kind).toBe("authorize_signer");
      expect(preview.deed).toBeNull();
      expect(preview.establishedJointly).toBe(false);

      const result = await acceptAsCoFounder(invitation.token, "Authorizing Co-Founder");
      userIds.push(result.user.id);
      founderIds.push(result.newFounderId!);

      const consent = await prisma.coFounderDeedConsent.findUniqueOrThrow({
        where: { foundationId_founderId: { foundationId: coFounderFoundationId, founderId: result.newFounderId! } },
      });
      expect(consent).toMatchObject({
        kind: "authorize_signer",
        foundationDeedId: null,
        userId: result.user.id,
        statementVersion: CO_FOUNDER_STATEMENT_VERSION,
        statementText: preview.statement.text,
        ipAddress: "198.51.100.4",
      });
      expect(consent.statementText).toContain("I authorize the founder who signs its Deed of Waqf to sign it for me");

      const logs = await auditLogsFor(consent.id);
      expect(logs).toEqual([expect.objectContaining({ action: "co_founder.deed_consented", actorFounderId: result.newFounderId })]);
    });

    test("accept() after the deed is signed records the co-founder adopting that deed", async () => {
      const { foundation, deed } = await foundationWithSignedDeed();
      const invitation = await inviteCoFounder(foundation.id, "adopt");
      const preview = await service.previewCoFounderInvitation(invitation.token);
      expect(preview.statement.kind).toBe("adopt_signed_deed");
      expect(preview.deed).toMatchObject({ signerName: "Founder A Primary Contact" });

      const result = await acceptAsCoFounder(invitation.token, "Adopting Co-Founder");
      userIds.push(result.user.id);
      founderIds.push(result.newFounderId!);

      const consent = await prisma.coFounderDeedConsent.findUniqueOrThrow({
        where: { foundationId_founderId: { foundationId: foundation.id, founderId: result.newFounderId! } },
      });
      expect(consent).toMatchObject({ kind: "adopt_signed_deed", foundationDeedId: deed.id });
      expect(consent.statementText).toContain("I adopt its Deed of Waqf, signed by Founder A Primary Contact on 14 November 2026");
    });

    test("a jointly established Foundation is joined as an individual, never an institution", async () => {
      const foundation = await foundationsService.create({
        name: `Co-Founder Spec Joint Foundation ${Date.now()}`,
        purpose: "Testing joint co-founders",
        founderIds: [coFounderFounderAId],
      });
      await prisma.foundation.update({ where: { id: foundation.id }, data: { establishedJointly: true } });
      const invitation = await inviteCoFounder(foundation.id, "joint-institution");
      expect((await service.previewCoFounderInvitation(invitation.token)).establishedJointly).toBe(true);

      await expect(
        service.accept({
          token: invitation.token,
          fullName: "Joint Institution",
          password: "correct-horse-battery",
          founderName: "Some Organization",
          kind: "institution",
          institutionType: "ngo",
          deedConsentVersion: CO_FOUNDER_STATEMENT_VERSION,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(await prisma.user.findUnique({ where: { email: invitation.email } })).toBeNull();
    });

    test("co_founder_deed_consents is immutable at the DB level — UPDATE and DELETE are both rejected by a trigger", async () => {
      const invitation = await inviteCoFounder(coFounderFoundationId, "immutable");
      const result = await acceptAsCoFounder(invitation.token, "Immutable Co-Founder");
      userIds.push(result.user.id);
      founderIds.push(result.newFounderId!);
      const consent = await prisma.coFounderDeedConsent.findUniqueOrThrow({
        where: { foundationId_founderId: { foundationId: coFounderFoundationId, founderId: result.newFounderId! } },
      });

      await expect(
        prisma.coFounderDeedConsent.update({ where: { id: consent.id }, data: { statementText: "Tampered" } }),
      ).rejects.toThrow(/immutable once written/i);
      await expect(prisma.coFounderDeedConsent.delete({ where: { id: consent.id } })).rejects.toThrow(/immutable once written/i);
    });

    test("previewCoFounderInvitation() is not found for anything but a pending, unexpired co_founder invitation", async () => {
      await expect(service.previewCoFounderInvitation("no-such-token")).rejects.toThrow(NotFoundException);

      const accepted = await inviteCoFounder(coFounderFoundationId, "preview-accepted");
      const result = await acceptAsCoFounder(accepted.token, "Preview Accepted Co-Founder");
      userIds.push(result.user.id);
      founderIds.push(result.newFounderId!);
      await expect(service.previewCoFounderInvitation(accepted.token)).rejects.toThrow(NotFoundException);

      const expired = await inviteCoFounder(coFounderFoundationId, "preview-expired");
      await prisma.invitation.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await expect(service.previewCoFounderInvitation(expired.token)).rejects.toThrow(NotFoundException);

      const founderUser = await service.invite({
        inviteeKind: "founder_user",
        email: `preview-founder-user-${Date.now()}@example.com`,
        founderId: existingFounderId,
        roleKey: "viewer",
        invitedByUserId: inviterUserId,
        invitedByActorType: "birr_staff",
      });
      invitationIds.push(founderUser.id);
      await expect(service.previewCoFounderInvitation(founderUser.token)).rejects.toThrow(NotFoundException);
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
