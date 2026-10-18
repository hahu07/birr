import { randomUUID } from "crypto";
import { BadRequestException } from "@nestjs/common";
import { Request } from "express";
import { prisma } from "@birr/db";
import { InvitationsController } from "./invitations.controller";
import { InvitationsService } from "./invitations.service";
import { ResendInvitationEmailAdapter } from "./email/resend-invitation.adapter";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";
import { signSessionToken, STAFF_SESSION_COOKIE_NAME } from "../../common/auth/session";

class FakeInvitationEmailAdapter {
  async sendInvitationEmail(): Promise<void> {}
}

function requestWithStaffCookie(token: string): Request {
  return { cookies: { [STAFF_SESSION_COOKIE_NAME]: token } } as unknown as Request;
}

// Regression coverage for staff onboarding. 2026-09-26: any staff member
// could invite a new staff member with any role, including a fresh
// platform_admin. 2026-10-18: not even a platform_admin can send one
// directly any more — adding staff is the staff.invite governed action,
// approved by a second person (see governed-actions.service.spec.ts).
describe("InvitationsController — birr_staff invitation authorization", () => {
  let nonAdminUserId: string;
  let adminUserId: string;
  let existingFounderId: string;
  const invitationIds: string[] = [];
  const founderIds: string[] = [];

  beforeAll(async () => {
    // Both mfaEnabled: true — several tests below expect these sessions
    // to succeed (not just clear the role gate), so they have to
    // represent fully-enrolled real staff members (see
    // resolveBirrStaffFromSession's own comment on why an unenrolled
    // session is now rejected before the role check ever runs).
    const nonAdminUser = await prisma.user.create({
      data: { email: `invitations-ctrl-nonadmin-${Date.now()}@example.test`, fullName: "Not An Admin", mfaEnabled: true },
    });
    nonAdminUserId = nonAdminUser.id;
    await prisma.birrStaff.create({ data: { userId: nonAdminUser.id, staffRole: "compliance_officer" } });

    const adminUser = await prisma.user.create({
      data: { email: `invitations-ctrl-admin-${Date.now()}@example.test`, fullName: "A Real Admin", mfaEnabled: true },
    });
    adminUserId = adminUser.id;
    await prisma.birrStaff.create({ data: { userId: adminUser.id, staffRole: "platform_admin" } });

    const founder = await prisma.founder.create({ data: { name: "Invitations Ctrl Fixture Founder", kind: "institution" } });
    existingFounderId = founder.id;
    founderIds.push(founder.id);
  });

  afterAll(async () => {
    await prisma.invitation.deleteMany({ where: { id: { in: invitationIds } } });
    await prisma.founder.deleteMany({ where: { id: { in: founderIds } } });
    await prisma.$disconnect();
  });

  function realController() {
    const emailAdapter = new FakeInvitationEmailAdapter();
    const service = new InvitationsService(emailAdapter as unknown as ResendInvitationEmailAdapter, createFakeNotificationsService());
    return new InvitationsController(service);
  }

  test.each([
    ["a non-platform_admin", () => nonAdminUserId],
    ["a platform_admin", () => adminUserId],
  ])("rejects %s staff member sending a birr_staff invitation directly", async (_label, userId) => {
    const controller = realController();
    const request = requestWithStaffCookie(signSessionToken(userId()));
    const email = `invitee-direct-${randomUUID().slice(0, 8)}@example.test`;

    await expect(
      controller.invite({ inviteeKind: "birr_staff", email, roleKey: "compliance_officer" }, request),
    ).rejects.toThrow(BadRequestException);
    expect(await prisma.invitation.count({ where: { email } })).toBe(0);
  });

  // Proves the restriction is scoped to inviteeKind === "birr_staff" only — a
  // non-admin staff member inviting a founder_user on a Founder's behalf
  // (a real, separate, pre-existing feature) must keep working exactly
  // as before.
  test("still allows a non-platform_admin staff member to invite a founder_user", async () => {
    const controller = realController();
    const request = requestWithStaffCookie(signSessionToken(nonAdminUserId));

    const result = await controller.invite(
      {
        inviteeKind: "founder_user",
        email: `invitee-founder-ok-${Date.now()}@example.test`,
        founderId: existingFounderId,
        roleKey: "viewer",
      },
      request,
    );
    invitationIds.push(result.id);
    expect(result.inviteeKind).toBe("founder_user");
  });
});
