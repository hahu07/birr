import { prisma } from "@birr/db";
import { createFakeNotificationsService } from "./test-support/fake-notifications-service";

// Regression coverage for the 2026-08-31 codebase audit finding:
// notification read-state only ever got fixed for message.received (via
// its own bespoke frontend logic), leaving 21 other notification types
// permanently stuck unread once viewed by any path other than the bell
// dropdown. markReadForEntity() is the generic primitive the fix is
// built on — every relevant frontend page calls it, scoped to whatever
// entity that page actually rendered.
describe("NotificationsService.markReadForEntity", () => {
  const service = createFakeNotificationsService();
  const notificationIds: string[] = [];
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `notifications-spec-${Date.now()}@example.test`, fullName: "Notifications Spec User" },
    });
    userId = user.id;
    const otherUser = await prisma.user.create({
      data: { email: `notifications-spec-other-${Date.now()}@example.test`, fullName: "Notifications Spec Other User" },
    });
    otherUserId = otherUser.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
    await prisma.$disconnect();
  });

  async function createNotification(
    overrides: Partial<{
      recipientUserId: string;
      type: string;
      relatedEntityType: string;
      relatedEntityId: string;
    }> = {},
  ) {
    const notification = await prisma.notification.create({
      data: {
        recipientType: "founder_user",
        recipientUserId: userId,
        type: "distribution.approved",
        title: "Distribution approved",
        body: "Test body",
        relatedEntityType: "Distribution",
        relatedEntityId: "dist-1",
        ...overrides,
      },
    });
    notificationIds.push(notification.id);
    return notification;
  }

  test("marks a matching unread notification as read", async () => {
    const notification = await createNotification();
    await service.markReadForEntity(userId, "Distribution", "dist-1");
    const updated = await prisma.notification.findUnique({ where: { id: notification.id } });
    expect(updated?.readAt).not.toBeNull();
  });

  test("does not mark a notification for a different entity id", async () => {
    const notification = await createNotification({ relatedEntityId: "dist-2" });
    await service.markReadForEntity(userId, "Distribution", "dist-1");
    const updated = await prisma.notification.findUnique({ where: { id: notification.id } });
    expect(updated?.readAt).toBeNull();
  });

  test("does not mark a notification for a different entity type", async () => {
    const notification = await createNotification({ relatedEntityType: "Contribution" });
    await service.markReadForEntity(userId, "Distribution", "dist-1");
    const updated = await prisma.notification.findUnique({ where: { id: notification.id } });
    expect(updated?.readAt).toBeNull();
  });

  test("does not mark another user's notification for the same entity", async () => {
    const notification = await createNotification({ recipientUserId: otherUserId });
    await service.markReadForEntity(userId, "Distribution", "dist-1");
    const updated = await prisma.notification.findUnique({ where: { id: notification.id } });
    expect(updated?.readAt).toBeNull();
  });

  test("marks every matching notification when more than one exists for the same entity", async () => {
    const first = await createNotification({ type: "distribution.approved" });
    const second = await createNotification({ type: "governed_action.decided" });
    await service.markReadForEntity(userId, "Distribution", "dist-1");
    const [updatedFirst, updatedSecond] = await Promise.all([
      prisma.notification.findUnique({ where: { id: first.id } }),
      prisma.notification.findUnique({ where: { id: second.id } }),
    ]);
    expect(updatedFirst?.readAt).not.toBeNull();
    expect(updatedSecond?.readAt).not.toBeNull();
  });
});
