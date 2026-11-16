import { EncryptionService } from "../../common/settings/encryption.service";
import { SettingsService } from "../../common/settings/settings.service";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { prisma } from "@birr/db";
import { FounderSuccessionService } from "./founder-succession.service";
import { OUTGOING_NOTICE_VERSION, outgoingNotice } from "./succession-notice";
import { renderEmailTemplate } from "../../common/email/notification-template";
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
  const service = new FounderSuccessionService(notifications, new SettingsService(new EncryptionService()));
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

  test("the notice gives Birr's contact details, so the contact can object without signing in", async () => {
    const before = { email: process.env.SUPPORT_CONTACT_EMAIL, phone: process.env.SUPPORT_CONTACT_PHONE };
    process.env.SUPPORT_CONTACT_EMAIL = "trustee@birr.example";
    process.env.SUPPORT_CONTACT_PHONE = "+234 800 000 0000";
    try {
      const { founder, contactUser, member } = await founderWithTeam();
      const succession = await service.recordUnreachable(makerUserId, {
        founderId: founder.id,
        newMembershipId: member.id,
        reason: "Institution says the contact has left.",
        evidenceNote: "Letter from the bank's HR, 9 Nov.",
      });
      const notice = await prisma.notification.findFirstOrThrow({ where: { recipientUserId: contactUser.id, type: "founder_succession.outgoing_notice", relatedEntityId: succession.id } });
      expect(notice.body).toContain("email trustee@birr.example or call +234 800 000 0000 (or reply to this email)");
      expect(notice.body).toContain("Nothing changes while you object.");
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: succession.id, action: "founder_succession.unreachable_reported" } });
      expect(audit.after).toMatchObject({ outgoingNoticeVersion: OUTGOING_NOTICE_VERSION });
    } finally {
      if (before.email === undefined) delete process.env.SUPPORT_CONTACT_EMAIL;
      else process.env.SUPPORT_CONTACT_EMAIL = before.email;
      if (before.phone === undefined) delete process.env.SUPPORT_CONTACT_PHONE;
      else process.env.SUPPORT_CONTACT_PHONE = before.phone;
    }
  });

  test("an objection by phone or email is recorded by staff, and blocks approval the same way", async () => {
    const { founder, contactUser, contact, member } = await founderWithTeam();
    const succession = await service.reportUnavailable(
      { userId: (await prisma.founderMembership.findUniqueOrThrow({ where: { id: member.id } })).userId, founderId: founder.id },
      { newMembershipId: member.id, reason: "They stopped answering in August.", evidenceNote: "Calls and letters unanswered." },
    );
    const objected = await service.recordObjection(succession.id, makerUserId, { note: `Phoned Birr on 17 Nov; voice and date of birth matched ${contactUser.fullName}.` });
    expect(objected).toMatchObject({ status: "objected" });
    expect(objected.objectionNote).toMatch(/^Received by Birr: Phoned Birr/);
    expect(await prisma.auditLog.count({ where: { entityId: succession.id, action: "founder_succession.objection_recorded", actorUserId: makerUserId } })).toBe(1);
    await prisma.primaryContactSuccession.update({ where: { id: succession.id }, data: { earliestApprovalAt: new Date(Date.now() - 1000) } });
    await expect(approve(succession.id)).rejects.toThrow(/objected/);
    expect(await membership(contact.id)).toMatchObject({ permissionLevel: "primary_contact" });

    // A handover is the contact's own request; there's nothing to object to.
    const other = await founderWithTeam();
    const handover = await service.requestHandover({ userId: other.contactUser.id, founderId: other.founder.id }, { newMembershipId: other.member.id, reason: "Retiring at the year end." });
    await expect(service.recordObjection(handover.id, makerUserId, { note: "Someone phoned to object." })).rejects.toThrow(BadRequestException);
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

describe("the outgoing contact's notice", () => {
  test("without Birr's contact details set, it still says how to object", () => {
    const notice = outgoingNotice({ founderName: "Bello Family Waqf", objectBy: "23 Nov 2026", contact: {} });
    expect(notice.body).toBe(
      "Someone has told Birr you can no longer act as primary contact of Bello Family Waqf. If that's wrong, object before 23 Nov 2026: sign in and open Team, or contact Birr directly. Nothing changes while you object.",
    );
    expect(outgoingNotice({ founderName: "X", objectBy: "1 Dec 2026", contact: { phone: "+234 1" } }).body).toContain("or call +234 1. Nothing");
  });

  test("its email never says it can be safely ignored", () => {
    const { emailFooter } = outgoingNotice({ founderName: "X", objectBy: "1 Dec 2026", contact: {} });
    const html = renderEmailTemplate({ heading: "h", bodyHtml: "<p>b</p>", footerText: emailFooter });
    expect(html).not.toContain("safely ignore");
    expect(html).toContain("Please don&#39;t ignore this message".replace("&#39;", "'"));
    expect(renderEmailTemplate({ heading: "h", bodyHtml: "<p>b</p>" })).toContain("safely ignore");
  });
});
