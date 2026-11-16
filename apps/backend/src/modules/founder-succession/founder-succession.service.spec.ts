import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { prisma } from "@birr/db";
import { FounderSuccessionService } from "./founder-succession.service";
import { InvitationsService } from "../invitations/invitations.service";
import type { ResendInvitationEmailAdapter } from "../invitations/email/resend-invitation.adapter";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";
import { assertWhatsAppVerified } from "../../common/auth/current-founder";

/**
 * The succession service on its own: asking, objecting, and the governed
 * handler's checks and swap, run inside a transaction the way decide()
 * runs them. The full propose/approve path, with the database refusing
 * checker = maker, is in governed-actions.service.spec.ts.
 */
describe("FounderSuccessionService", () => {
  const notifications = createFakeNotificationsService();
  const service = new FounderSuccessionService(notifications);
  const invitations = new InvitationsService({ sendInvitationEmail: async () => undefined } as unknown as ResendInvitationEmailAdapter, notifications);

  let makerUserId: string;
  let checkerUserId: string;
  const founderIds: string[] = [];

  async function user(label: string) {
    return prisma.user.create({ data: { email: `succession-${label}-${randomUUID().slice(0, 8)}@example.com`, fullName: `Succession ${label}`, status: "active" } });
  }

  /** A Founder with a primary contact and one viewer. */
  async function founderWithTeam() {
    const founder = await prisma.founder.create({ data: { name: `Succession Fixture ${randomUUID().slice(0, 6)}`, kind: "institution" } });
    founderIds.push(founder.id);
    const contactUser = await user("contact");
    const memberUser = await user("member");
    const contact = await prisma.founderMembership.create({ data: { founderId: founder.id, userId: contactUser.id, permissionLevel: "primary_contact" } });
    const member = await prisma.founderMembership.create({ data: { founderId: founder.id, userId: memberUser.id, permissionLevel: "viewer" } });
    return { founder, contactUser, memberUser, contact, member };
  }

  const approve = (successionId: string) =>
    prisma.$transaction((tx) => service.approveChange({ successionId }, tx, { checkerUserId, makerUserId, governedActionId: randomUUID() }));

  const membership = (id: string) => prisma.founderMembership.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    makerUserId = (await user("maker")).id;
    checkerUserId = (await user("checker")).id;
  });

  afterAll(async () => {
    // Fixture cases left open would otherwise sit in the Ops Console's
    // Primary Contact Changes list (founders stay; the audit log names them).
    await prisma.primaryContactSuccession.updateMany({ where: { founderId: { in: founderIds }, status: { in: ["requested", "approved", "objected"] } }, data: { status: "cancelled" } });
    await prisma.$disconnect();
  });

  test("handover to an existing member: the primary contact asks, approval swaps them, and it's all audited", async () => {
    const { founder, contactUser, contact, member } = await founderWithTeam();
    const succession = await service.requestHandover({ userId: contactUser.id, founderId: founder.id }, { newMembershipId: member.id, reason: "Retiring as Bursar at the end of the year." });
    expect(succession).toMatchObject({ kind: "handover", status: "requested", outgoingNotifiedAt: null });
    await service.validateChange({ successionId: succession.id });

    await approve(succession.id);
    expect(await membership(contact.id)).toMatchObject({ permissionLevel: "viewer", status: "active" });
    expect(await membership(member.id)).toMatchObject({ permissionLevel: "primary_contact", status: "active" });
    expect(await prisma.primaryContactSuccession.findUniqueOrThrow({ where: { id: succession.id } })).toMatchObject({ status: "completed" });
    const actions = (await prisma.auditLog.findMany({ where: { OR: [{ entityId: succession.id }, { entityId: { in: [contact.id, member.id] } }] } })).map((a) => a.action).sort();
    expect(actions).toEqual(
      ["founder_membership.primary_contact_changed", "founder_membership.primary_contact_stepped_down", "founder_succession.completed", "founder_succession.handover_requested"].sort(),
    );
  });

  test("only the primary contact can hand over; only a member can report them gone; the primary contact can't report themselves", async () => {
    const { founder, contactUser, memberUser, member } = await founderWithTeam();
    await expect(service.requestHandover({ userId: memberUser.id, founderId: founder.id }, { newMembershipId: member.id, reason: "I would like the role please." })).rejects.toThrow(ForbiddenException);
    const outsider = await user("outsider");
    await expect(
      service.reportUnavailable({ userId: outsider.id, founderId: founder.id }, { newMembershipId: member.id, reason: "They are not answering.", evidenceNote: "No reply for three months." }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.reportUnavailable({ userId: contactUser.id, founderId: founder.id }, { newMembershipId: member.id, reason: "Reporting myself away.", evidenceNote: "Testing self report." }),
    ).rejects.toThrow(BadRequestException);
  });

  test("unreachable: the outgoing contact is told at once, can't be replaced for 7 days, and can object", async () => {
    const { founder, contactUser, memberUser, contact, member } = await founderWithTeam();
    const succession = await service.reportUnavailable(
      { userId: memberUser.id, founderId: founder.id },
      { newMembershipId: member.id, reason: "Our chair passed away last month.", evidenceNote: "Death certificate can be provided; obituary in Daily Trust, 3 Nov." },
    );
    expect(succession.earliestApprovalAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * 24 * 3600 * 1000);
    expect(await prisma.notification.findFirst({ where: { recipientUserId: contactUser.id, type: "founder_succession.outgoing_notice", relatedEntityId: succession.id } })).not.toBeNull();

    await expect(approve(succession.id)).rejects.toThrow(/can't be approved before/);
    // Nobody else can object for them.
    await expect(service.object(succession.id, memberUser.id, { note: "I object on their behalf." })).rejects.toThrow(ForbiddenException);
    await service.object(succession.id, contactUser.id, { note: "I'm alive and well, this is wrong." });
    await prisma.primaryContactSuccession.update({ where: { id: succession.id }, data: { earliestApprovalAt: new Date(Date.now() - 1000) } });
    await expect(approve(succession.id)).rejects.toThrow(/objected/);
    expect(await membership(contact.id)).toMatchObject({ permissionLevel: "primary_contact", status: "active" });

    const closed = await service.closeByStaff(succession.id, makerUserId, { note: "Spoke to the chair by phone; request was mistaken." });
    expect(closed.status).toBe("cancelled");
  });

  test("unreachable, after the notice period: the outgoing contact is revoked and the new one takes over", async () => {
    const { founder, contact, member } = await founderWithTeam();
    const succession = await service.recordUnreachable(makerUserId, {
      founderId: founder.id,
      newMembershipId: member.id,
      reason: "The bank's new treasurer takes over.",
      evidenceNote: "Board resolution dated 1 Nov 2026 seen and filed.",
    });
    await prisma.primaryContactSuccession.update({ where: { id: succession.id }, data: { earliestApprovalAt: new Date(Date.now() - 1000) } });
    await approve(succession.id);
    expect(await membership(contact.id)).toMatchObject({ status: "revoked" });
    expect(await membership(member.id)).toMatchObject({ permissionLevel: "primary_contact" });
  });

  test("after the swap, the Founder's checks look at the new contact, never the revoked one", async () => {
    const { founder, contactUser, member } = await founderWithTeam();
    await prisma.user.update({ where: { id: contactUser.id }, data: { whatsappVerifiedAt: new Date() } });
    await expect(assertWhatsAppVerified(prisma, founder.id)).resolves.toBeUndefined();
    const succession = await service.recordUnreachable(makerUserId, {
      founderId: founder.id,
      newMembershipId: member.id,
      reason: "The institution appointed a new treasurer.",
      evidenceNote: "Appointment letter dated 5 Nov, filed.",
    });
    await prisma.primaryContactSuccession.update({ where: { id: succession.id }, data: { earliestApprovalAt: new Date(Date.now() - 1000) } });
    await approve(succession.id);
    // The new contact hasn't verified WhatsApp; the revoked one had.
    await expect(assertWhatsAppVerified(prisma, founder.id)).rejects.toThrow(/WhatsApp/);
  });

  test("handover to someone new: approval invites them and keeps the old contact until they accept", async () => {
    const { founder, contactUser, contact } = await founderWithTeam();
    const newEmail = `succession-new-${randomUUID().slice(0, 8)}@example.com`;
    const succession = await service.requestHandover({ userId: contactUser.id, founderId: founder.id }, { newEmail, newFullName: "Zainab Sule", reason: "Handing over to our new director." });
    const fulfillment = await approve(succession.id);
    expect(fulfillment.entityType).toBe("Invitation");
    const pending = await prisma.primaryContactSuccession.findUniqueOrThrow({ where: { id: succession.id } });
    expect(pending.status).toBe("approved");
    // A willing contact keeps the role until their successor is in place.
    expect(await membership(contact.id)).toMatchObject({ permissionLevel: "primary_contact", status: "active" });

    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { id: pending.invitationId! } });
    const accepted = await invitations.accept({ token: invitation.token, fullName: "Zainab Sule", password: "correct-horse-battery" });
    expect(accepted.membershipOrStaff).toMatchObject({ founderId: founder.id, permissionLevel: "primary_contact" });
    expect(await membership(contact.id)).toMatchObject({ permissionLevel: "viewer" });
    expect(await prisma.primaryContactSuccession.findUniqueOrThrow({ where: { id: succession.id } })).toMatchObject({ status: "completed" });
  });

  test("the database allows one active primary contact and one open change per Founder", async () => {
    const { founder, contactUser, member } = await founderWithTeam();
    const extra = await user("extra");
    await expect(prisma.founderMembership.create({ data: { founderId: founder.id, userId: extra.id, permissionLevel: "primary_contact" } })).rejects.toThrow();
    await service.requestHandover({ userId: contactUser.id, founderId: founder.id }, { newMembershipId: member.id, reason: "First request for handover." });
    await expect(service.requestHandover({ userId: contactUser.id, founderId: founder.id }, { newMembershipId: member.id, reason: "Second request for handover." })).rejects.toThrow(ConflictException);
  });

  test("someone who already has a Birr account must join the team first", async () => {
    const { founder, contactUser } = await founderWithTeam();
    const existing = await user("existing");
    await expect(
      service.requestHandover({ userId: contactUser.id, founderId: founder.id }, { newEmail: existing.email, newFullName: "Existing Person", reason: "Handing to an existing account." }),
    ).rejects.toThrow(/Invite them to your team first/);
  });
});
