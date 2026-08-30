import { prisma } from "@birr/db";
import { NotFoundException } from "@nestjs/common";
import { MessagesService } from "./messages.service";
import { MessageAttachmentStorageService } from "./message-attachment-storage.service";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";

// send()'s notifyRecipients() call is deliberately fire-and-forget
// (post-commit, not awaited — same posture as
// GovernedActionsService.decide()'s own notifyDecision() call) — a
// single fixed sleep before asserting is inherently flaky under real
// load (this file failed exactly this way when run right after a
// backend restart). Poll instead: check every 20ms, up to 1s, for the
// expected notification count to actually land.
async function waitForNotifications(where: { type: string; relatedEntityId: string }, atLeast = 1) {
  const deadline = Date.now() + 15000;
  let found: Awaited<ReturnType<typeof prisma.notification.findMany>> = [];
  while (Date.now() < deadline) {
    found = await prisma.notification.findMany({ where });
    if (found.length >= atLeast) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return found;
}

describe("MessagesService", () => {
  const service = new MessagesService(new MessageAttachmentStorageService(), createFakeNotificationsService());

  const messageIds: string[] = [];
  const waqfCaseAssignmentIds: string[] = [];
  const waqfIds: string[] = [];
  const foundationIds: string[] = [];

  let foundationId: string;
  let founderId: string;
  let founderUserAId: string;
  let founderUserBId: string;
  let staffUserId: string;
  let staffId: string;
  let waqfId: string;

  let otherFoundationId: string;
  let otherFounderId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff/Founder rows not cleaned up in afterAll —
    // same reasoning as other spec files in this codebase (referenced
    // via audit_logs, which is insert-only at the DB role level).
    const staffUser = await prisma.user.create({
      data: { email: `messages-staff-${Date.now()}@example.com`, fullName: "Test Staff" },
    });
    staffUserId = staffUser.id;
    const staff = await prisma.birrStaff.create({ data: { userId: staffUser.id, staffRole: "mutawalli_officer" } });
    staffId = staff.id;

    const founderUserA = await prisma.user.create({
      data: { email: `messages-founder-a-${Date.now()}@example.com`, fullName: "Founder User A" },
    });
    founderUserAId = founderUserA.id;
    const founderUserB = await prisma.user.create({
      data: { email: `messages-founder-b-${Date.now()}@example.com`, fullName: "Founder User B" },
    });
    founderUserBId = founderUserB.id;

    const founder = await prisma.founder.create({ data: { name: "Messages Fixture Founder", kind: "institution" } });
    founderId = founder.id;
    await prisma.founderMembership.create({
      data: { founderId, userId: founderUserAId, permissionLevel: "primary_contact", status: "active" },
    });
    await prisma.founderMembership.create({
      data: { founderId, userId: founderUserBId, permissionLevel: "viewer", status: "active" },
    });

    const foundation = await prisma.foundation.create({ data: { name: "Messages Fixture Foundation" } });
    foundationId = foundation.id;
    foundationIds.push(foundation.id);
    await prisma.foundationFounder.create({ data: { foundationId, founderId } });

    const waqf = await prisma.waqf.create({
      data: { name: "Messages Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId },
    });
    waqfId = waqf.id;
    waqfIds.push(waqf.id);

    const assignment = await prisma.waqfCaseAssignment.create({
      data: { waqfId, birrStaffId: staffId, assignmentRole: "mutawalli_officer", status: "active" },
    });
    waqfCaseAssignmentIds.push(assignment.id);

    const otherFounder = await prisma.founder.create({ data: { name: "Messages Other Founder", kind: "institution" } });
    otherFounderId = otherFounder.id;
    const otherFoundation = await prisma.foundation.create({ data: { name: "Messages Other Foundation" } });
    otherFoundationId = otherFoundation.id;
    foundationIds.push(otherFoundation.id);
    await prisma.foundationFounder.create({ data: { foundationId: otherFoundationId, founderId: otherFounderId } });
  });

  afterAll(async () => {
    await prisma.messageAttachment.deleteMany({ where: { messageId: { in: messageIds } } });
    await prisma.message.deleteMany({ where: { id: { in: messageIds } } });
    await prisma.waqfCaseAssignment.deleteMany({ where: { id: { in: waqfCaseAssignmentIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.foundationFounder.deleteMany({ where: { foundationId: { in: foundationIds } } });
    await prisma.foundation.deleteMany({ where: { id: { in: foundationIds } } });
    await prisma.$disconnect();
  });

  test("send() as a founder creates a Message with no attachments", async () => {
    const message = await service.send(
      { foundationId, body: "Hello from the founder" },
      { senderType: "founder_user", senderUserId: founderUserAId, founderId },
      [],
    );
    messageIds.push(message.id);

    expect(message.body).toBe("Hello from the founder");
    expect(message.senderType).toBe("founder_user");
    expect(message.attachments).toHaveLength(0);
  });

  test("send() as a founder rejects a foundation that isn't theirs", async () => {
    await expect(
      service.send(
        { foundationId: otherFoundationId, body: "Shouldn't work" },
        { senderType: "founder_user", senderUserId: founderUserAId, founderId },
        [],
      ),
    ).rejects.toThrow(NotFoundException);
  });

  test("send() as Birr staff creates a Message, no ownership check applied", async () => {
    const message = await service.send(
      { foundationId, body: "Hello from Birr staff" },
      { senderType: "birr_staff", senderUserId: staffUserId },
      [],
    );
    messageIds.push(message.id);

    expect(message.senderType).toBe("birr_staff");
    expect(message.senderUser.id).toBe(staffUserId);
  });

  test("list() returns every message for a foundation regardless of sender type", async () => {
    const messages = await service.list(foundationId);
    const ids = messages.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(messageIds));
  });

  test("listForFounder() returns null for a foundation that isn't the caller's", async () => {
    const result = await service.listForFounder(otherFoundationId, founderId);
    expect(result).toBeNull();
  });

  test("listForFounder() returns the same messages as list() for the owning founder", async () => {
    const result = await service.listForFounder(foundationId, founderId);
    expect(result).not.toBeNull();
    const ids = result!.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(messageIds));
  });

  test("a founder-sent message notifies staff with an active case assignment on the foundation's waqf(s)", async () => {
    const message = await service.send(
      { foundationId, body: "Notify staff please" },
      { senderType: "founder_user", senderUserId: founderUserAId, founderId },
      [],
    );
    messageIds.push(message.id);

    const notifications = await waitForNotifications({ type: "message.received", relatedEntityId: message.id });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ recipientType: "birr_staff", recipientUserId: staffUserId });
  }, 20_000);

  test("a staff-sent message notifies every active founder membership on the foundation", async () => {
    const message = await service.send(
      { foundationId, body: "Notify founders please" },
      { senderType: "birr_staff", senderUserId: staffUserId },
      [],
    );
    messageIds.push(message.id);

    const notifications = await waitForNotifications({ type: "message.received", relatedEntityId: message.id }, 2);
    const recipientIds = notifications.map((n) => n.recipientUserId).sort();
    expect(recipientIds).toEqual([founderUserAId, founderUserBId].sort());
  }, 20_000);

  describe("inbox()", () => {
    test("returns one row per foundation, most-recently-active first, with the latest message only", async () => {
      const inbox = await service.inbox();
      const row = inbox.find((r) => r.foundation.id === foundationId);
      expect(row).toBeDefined();
      // Latest message on this foundation at this point is the
      // "Notify founders please" one sent by staff, just above.
      expect(row!.lastMessage.body).toBe("Notify founders please");
      expect(row!.lastMessage.senderType).toBe("birr_staff");

      // One row per foundation, not one row per message.
      const occurrences = inbox.filter((r) => r.foundation.id === foundationId);
      expect(occurrences).toHaveLength(1);
    });
  });

  describe("inboxForFounder()", () => {
    test("only includes foundations the founder is actually attached to", async () => {
      const inbox = await service.inboxForFounder(founderId);
      expect(inbox.some((r) => r.foundation.id === foundationId)).toBe(true);
      expect(inbox.some((r) => r.foundation.id === otherFoundationId)).toBe(false);
    });

    test("a founder with no messages on their own foundation gets an empty inbox", async () => {
      const inbox = await service.inboxForFounder(otherFounderId);
      expect(inbox).toHaveLength(0);
    });
  });
});
