import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { InvitationsService } from "./invitations.service";

describe("InvitationsService", () => {
  const service = new InvitationsService();

  const invitationIds: string[] = [];
  const founderIds: string[] = [];
  const userIds: string[] = [];

  let inviterUserId: string;
  let existingFounderId: string;

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
  });

  afterAll(async () => {
    // FK-safe order: FounderMembership/BirrStaff (created by accept())
    // before the Users/Founders they reference. Fixture Users/BirrStaff
    // created directly (not via accept()) are left in place, same
    // reasoning as every other spec file — audit_logs.actorUserId is
    // insert-only at the DB role level.
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

    const logs = await auditLogsFor(invitation.id);
    expect(logs.some((l) => l.action === "invitation.sent")).toBe(true);
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
});
