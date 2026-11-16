import { prisma, BirrStaffRole } from "@birr/db";
import { randomUUID } from "crypto";
import { RolesService, ACCESS_REVIEW_INTERVAL_DAYS } from "./roles.service";
import { remindIfAccessReviewDue } from "./access-review-scheduler";
import { staffHasAccess } from "../../common/auth/staff-permissions";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";

// Roles & Access, rebuilt 2026-11-16 (owner's decisions). Runs against the
// shared dev database; people it creates stay (the audit log names them).
describe("RolesService", () => {
  const service = new RolesService();
  let boardUserId: string;

  const person = async (label: string, role: BirrStaffRole) => {
    const user = await prisma.user.create({ data: { email: `roles-${label}-${randomUUID().slice(0, 8)}@example.com`, fullName: `Roles ${label}` } });
    await prisma.birrStaff.create({ data: { userId: user.id, roles: { create: { role } } } });
    return user.id;
  };

  beforeAll(async () => {
    boardUserId = await person("board", "board_of_trustees");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("only staff managers may open Roles & Access, and only the Board completes an access review", async () => {
    for (const role of ["platform_admin", "board_of_trustees", "compliance_officer", "audit_committee"] as const) {
      expect(await staffHasAccess({ roles: [role] }, "roles.view")).toBe(true);
    }
    for (const role of ["mutawalli_officer", "investment_committee", "external_auditor"] as const) {
      expect(await staffHasAccess({ roles: [role] }, "roles.view")).toBe(false);
    }
    expect(await staffHasAccess({ roles: ["board_of_trustees"] }, "roles.access_review")).toBe(true);
    expect(await staffHasAccess({ roles: ["platform_admin"] }, "roles.access_review")).toBe(false);
  });

  test("the overview lists every permission, even one no role holds, and the people in each role", async () => {
    const key = `test.ungranted_${randomUUID().slice(0, 8)}`;
    const orphan = await prisma.permission.create({ data: { key, category: "test", description: "Held by no role." } });
    try {
      const { roles, permissions, holders } = await service.overview();
      expect(permissions.map((p) => p.key)).toContain(key);
      expect(roles.every((r) => r.rolePermissions.every((rp) => rp.permission.key !== key))).toBe(true);
      expect(holders.board_of_trustees.map((h) => h.id)).toEqual(
        expect.arrayContaining([(await prisma.birrStaff.findUniqueOrThrow({ where: { userId: boardUserId } })).id]),
      );
    } finally {
      await prisma.permission.delete({ where: { id: orphan.id } });
    }
  });

  test("preview runs the guard rails on a batch without proposing it", async () => {
    // Only this kind of action: other specs running alongside propose their own.
    const proposals = { where: { permission: { key: "role.permission_change" } } };
    const before = await prisma.governedAction.count(proposals);
    const { checks } = await service.preview([
      { roleKey: "legal_adviser", permissionKey: "vault.expense_record", canMaker: true, canChecker: false },
      { roleKey: "external_auditor", permissionKey: "asset.dispose", canMaker: false, canChecker: true },
      { roleKey: "board_of_trustees", permissionKey: "role.permission_change", canMaker: false, canChecker: false },
    ]);
    expect(checks.map((c) => c.problem)).toEqual([null, expect.stringMatching(/External Auditor/), expect.stringMatching(/nobody active able to approve/)]);
    expect(checks[0]).toMatchObject({ before: { canMaker: false, canChecker: false }, affectedPeople: expect.any(Number) });
    expect(await prisma.governedAction.count(proposals)).toBe(before);
  });

  test("the export is the full matrix as CSV, and who exported it is audited", async () => {
    const { filename, csv } = await service.exportCsv(boardUserId);
    expect(filename).toMatch(/^birr-access-matrix-\d{4}-\d{2}-\d{2}\.csv$/);
    const rows = csv.trim().split("\n");
    expect(rows[0]).toMatch(/^# Birr access matrix, generated .* by Roles board/);
    expect(rows[1]).toBe("role,role_name,people_in_role,area,permission,description,type,can_propose,can_approve,allowed");
    const [roleCount, permissionCount] = await Promise.all([prisma.role.count(), prisma.permission.count()]);
    expect(rows.length - 2).toBe(roleCount * permissionCount);
    expect(rows).toEqual(expect.arrayContaining([expect.stringMatching(/^board_of_trustees,Board of Trustees,\d+,staff,role\.permission_change,.*,approval,no,yes,$/)]));
    expect(await prisma.auditLog.findFirst({ where: { action: "roles.matrix_exported", actorUserId: boardUserId } })).not.toBeNull();
  });

  describe("access reviews", () => {
    const allConfirmed = async () => (await prisma.role.findMany()).map((r) => ({ roleKey: r.key, outcome: "confirmed" }));

    test("must cover every role, and a role needing changes needs a note", async () => {
      const outcomes = await allConfirmed();
      await expect(service.completeAccessReview({ outcomes: outcomes.slice(1) }, boardUserId)).rejects.toThrow(/Review every role/);
      const needsChange = outcomes.map((o, i) => (i === 0 ? { ...o, outcome: "changes_needed" } : o));
      await expect(service.completeAccessReview({ outcomes: needsChange }, boardUserId)).rejects.toThrow(/Say what needs changing/);
      await expect(service.completeAccessReview({ outcomes: [...outcomes, outcomes[0]] }, boardUserId)).rejects.toThrow(/once/);
    });

    test("records who reviewed, each role's outcome and the grants at that moment, and can never be changed", async () => {
      const outcomes = (await allConfirmed()).map((o) =>
        o.roleKey === "compliance_officer" ? { ...o, outcome: "changes_needed", note: "Drop vault.curate from Compliance." } : o,
      );
      const review = await service.completeAccessReview({ outcomes, notes: "Quarterly review." }, boardUserId);
      expect(review.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
      expect(review.outcomes).toEqual(expect.arrayContaining([{ roleKey: "compliance_officer", outcome: "changes_needed", note: "Drop vault.curate from Compliance." }]));
      expect(await prisma.auditLog.findFirst({ where: { action: "access_review.completed", entityId: review.id } })).not.toBeNull();

      await expect(prisma.accessReview.update({ where: { id: review.id }, data: { notes: "edited" } })).rejects.toThrow(/never changed or deleted/);
      await expect(prisma.accessReview.delete({ where: { id: review.id } })).rejects.toThrow(/never changed or deleted/);

      const status = await service.accessReviews();
      expect(status.reviews[0].id).toBe(review.id);
      expect(status.nextDueAt!.getTime() - status.lastCompletedAt!.getTime()).toBe(ACCESS_REVIEW_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
    });
  });

  test("the Board is reminded when the review is overdue, and not again within a week", async () => {
    const notifications = createFakeNotificationsService();
    const day = 24 * 60 * 60 * 1000;
    // Far enough ahead that any review recorded so far is overdue.
    const later = new Date(Date.now() + (ACCESS_REVIEW_INTERVAL_DAYS + 30) * day);
    const sentBefore = new Date();
    try {
      // Not yet due today, just after a review.
      expect(await remindIfAccessReviewDue(notifications, new Date())).toBe(0);

      const sent = await remindIfAccessReviewDue(notifications, later);
      expect(sent).toBeGreaterThan(0);
      const reminder = await prisma.notification.findFirstOrThrow({ where: { type: "access_review.due", recipientUserId: boardUserId, createdAt: { gte: sentBefore } } });
      expect(reminder).toMatchObject({ title: "The access review is due", linkUrl: "/ops/roles?tab=reviews" });

      // As if those reminders went out a day before `later`: not again yet.
      await prisma.notification.updateMany({ where: { type: "access_review.due", createdAt: { gte: sentBefore } }, data: { createdAt: new Date(later.getTime() - day) } });
      expect(await remindIfAccessReviewDue(notifications, later)).toBe(0);
    } finally {
      await prisma.notification.deleteMany({ where: { type: "access_review.due", OR: [{ createdAt: { gte: sentBefore } }, { createdAt: { gte: new Date(later.getTime() - 2 * day) } }] } });
    }
    // Every active Board member in the shared database is notified.
  }, 60000);
});
