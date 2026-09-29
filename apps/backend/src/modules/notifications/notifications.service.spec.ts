import { prisma } from "@birr/db";
import { createFakeNotificationsService, createFakeNotificationsServiceWithSpies } from "./test-support/fake-notifications-service";

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

// New with notification preferences (2026-09-14) — a per-user, per-
// category opt-out layered on top of CHANNEL_PLAN. These tests prove
// the two invariants that matter: a preference can only narrow what
// CHANNEL_PLAN already allows (never widen an unmapped/disabled
// channel), and an unmapped type ignores preferences entirely.
describe("NotificationsService — notification preferences", () => {
  const notificationIds: string[] = [];
  const preferenceUserIds: string[] = [];

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: preferenceUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: preferenceUserIds } } });
    await prisma.$disconnect();
  });

  async function createUser(overrides: Partial<{ whatsappNumber: string; whatsappVerifiedAt: Date }> = {}) {
    const user = await prisma.user.create({
      data: {
        email: `notification-prefs-${Date.now()}-${Math.random()}@example.test`,
        fullName: "Notification Preferences Test User",
        ...overrides,
      },
    });
    preferenceUserIds.push(user.id);
    return user;
  }

  test("getPreferences() defaults every category to {emailEnabled: true, whatsappEnabled: true} with no rows", async () => {
    const { service } = createFakeNotificationsServiceWithSpies();
    const user = await createUser();
    const preferences = await service.getPreferences(user.id);
    expect(preferences).toEqual({
      governance: { emailEnabled: true, whatsappEnabled: true },
      money: { emailEnabled: true, whatsappEnabled: true },
      team: { emailEnabled: true, whatsappEnabled: true },
      messages: { emailEnabled: true, whatsappEnabled: true },
    });
  });

  test("setPreference() persists and getPreferences() reflects it, other categories untouched", async () => {
    const { service } = createFakeNotificationsServiceWithSpies();
    const user = await createUser();
    await service.setPreference(user.id, "messages", { emailEnabled: false, whatsappEnabled: true });
    const preferences = await service.getPreferences(user.id);
    expect(preferences.messages).toEqual({ emailEnabled: false, whatsappEnabled: true });
    expect(preferences.money).toEqual({ emailEnabled: true, whatsappEnabled: true });
  });

  test("notify() skips email for a mapped type when the category's emailEnabled is false, but still writes the in-app row", async () => {
    const { service, emailAdapter } = createFakeNotificationsServiceWithSpies();
    const user = await createUser();
    await service.setPreference(user.id, "messages", { emailEnabled: false, whatsappEnabled: true });

    await service.notify({
      recipientType: "founder_user",
      recipientUserId: user.id,
      type: "message.received", // CHANNEL_PLAN: {email: true, whatsapp: false}; category: "messages"
      title: "New message",
      body: "Test body",
    });

    expect(emailAdapter.sent).toHaveLength(0);
    const notification = await prisma.notification.findFirst({ where: { recipientUserId: user.id } });
    expect(notification).not.toBeNull();
    notificationIds.push(notification!.id);
  });

  test("notify() skips WhatsApp for a mapped type when the category's whatsappEnabled is false, even with a verified number", async () => {
    const { service, whatsAppAdapter } = createFakeNotificationsServiceWithSpies();
    const user = await createUser({ whatsappNumber: "+15550001111", whatsappVerifiedAt: new Date() });
    await service.setPreference(user.id, "money", { emailEnabled: true, whatsappEnabled: false });

    await service.notify({
      recipientType: "founder_user",
      recipientUserId: user.id,
      type: "distribution.paid", // CHANNEL_PLAN: {email: true, whatsapp: true}; category: "money"
      title: "Distribution paid",
      body: "Test body",
    });

    expect(whatsAppAdapter.sent).toHaveLength(0);
    const notification = await prisma.notification.findFirst({ where: { recipientUserId: user.id } });
    notificationIds.push(notification!.id);
  });

  test("notify() ignores preferences entirely for a type with no category mapping", async () => {
    const { service, emailAdapter, whatsAppAdapter } = createFakeNotificationsServiceWithSpies();
    const user = await createUser({ whatsappNumber: "+15550002222", whatsappVerifiedAt: new Date() });
    // Disabling every mapped category should have zero effect on an
    // unmapped, Critical-tier type — preferences can only narrow
    // CHANNEL_PLAN, never be consulted for a type outside their scope.
    await Promise.all(
      (["governance", "money", "team", "messages"] as const).map((category) =>
        service.setPreference(user.id, category, { emailEnabled: false, whatsappEnabled: false }),
      ),
    );

    await service.notify({
      recipientType: "birr_staff",
      recipientUserId: user.id,
      type: "governed_action.proposed", // CHANNEL_PLAN: {email: true, whatsapp: true}; unmapped
      title: "Action needs a checker",
      body: "Test body",
    });

    expect(emailAdapter.sent).toHaveLength(1);
    expect(whatsAppAdapter.sent).toHaveLength(1);
    const notification = await prisma.notification.findFirst({ where: { recipientUserId: user.id } });
    notificationIds.push(notification!.id);
  });

  // 2026-09-29 codebase walkthrough finding: every notification's
  // linkUrl is built as a bare relative path (e.g. "/portfolio/abc") —
  // correct for the in-app bell's own router, but not a valid, clickable
  // link on an external channel with no router of its own. Both the
  // WhatsApp message and the email's CTA had been sending that same
  // relative path straight through, unresolved, since the day either
  // channel shipped.
  test("notify() sends an absolute link to both email and WhatsApp, but keeps the in-app row's own linkUrl relative", async () => {
    const originalPortalUrl = process.env.FOUNDER_PORTAL_URL;
    process.env.FOUNDER_PORTAL_URL = "https://birr-web.onrender.com";
    try {
      const { service, emailAdapter, whatsAppAdapter } = createFakeNotificationsServiceWithSpies();
      const user = await createUser({ whatsappNumber: "+15550003333", whatsappVerifiedAt: new Date() });

      await service.notify({
        recipientType: "founder_user",
        recipientUserId: user.id,
        type: "waqf.activated", // CHANNEL_PLAN: {email: true, whatsapp: true}
        title: "Test Waqf Fund is now active",
        body: "Test body",
        linkUrl: "/portfolio/b9f34530-d134-414f-8de1-98347758ce6a",
      });

      expect(emailAdapter.sent[0].linkUrl).toBe("https://birr-web.onrender.com/portfolio/b9f34530-d134-414f-8de1-98347758ce6a");
      expect(whatsAppAdapter.sent[0].body).toContain("https://birr-web.onrender.com/portfolio/b9f34530-d134-414f-8de1-98347758ce6a");
      expect(whatsAppAdapter.sent[0].body).not.toContain("\n/portfolio/"); // never the unresolved relative path

      const notification = await prisma.notification.findFirst({ where: { recipientUserId: user.id } });
      notificationIds.push(notification!.id);
      // The in-app bell's own router needs the relative path, not the
      // absolute one — see AppShell's handleSelectNotification.
      expect(notification!.linkUrl).toBe("/portfolio/b9f34530-d134-414f-8de1-98347758ce6a");
    } finally {
      process.env.FOUNDER_PORTAL_URL = originalPortalUrl;
    }
  });
});
